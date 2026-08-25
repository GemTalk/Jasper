// Native (C/C++) repro for a crash in GciTsNbPoll -- for the GemStone core
// team, so the bug can be reproduced without any of Jasper's own tooling.
// See docs/explanation/gci-nb-poll-crash-repro.md for the full writeup and
// the equivalent Node/vitest repro this mirrors.
//
// Hypothesis: GciTsNbPoll does not validate its session argument before
// dereferencing the outstanding call's state, so polling a session that was
// logged out while a non-blocking call was still in flight segfaults the
// process instead of returning the documented -1 (invalid session) result.
// Only applies to GemStone 3.7.0+, which exports GciTsNbPoll.
//
// This links against nothing but libc/libdl (POSIX) or the Windows API --
// the GCI library itself is loaded at runtime via dlopen/LoadLibrary, and
// each GciTsXxx symbol is resolved individually via dlsym/GetProcAddress
// into a locally-declared function pointer, so no import library is needed
// on Windows and no gcits.hf declaration is ever directly referenced.
// #include "gcits.hf" is only for its type/struct/constant definitions
// (GciSession, GciErrSType, OopType, OOP_*, GCI_LOGIN_QUIET).
//
// Build (point -I at a real GemStone install's own include/ dir --
// vendor/gci-headers/ in this repo is deliberately incomplete, a reference
// for signatures rather than something to compile against; see its
// versions.md):
//   c++ -I <gs-install>/include gci_nb_poll_after_logout.cpp -o repro -ldl   (Linux)
//   c++ -I <gs-install>/include gci_nb_poll_after_logout.cpp -o repro       (macOS)
//   cl /I <gs-install>\include gci_nb_poll_after_logout.cpp                 (Windows, MSVC)
//
// Run, with the GCI connection details in the environment (same names
// `.env.test` uses, so `set -a && source client/.env.test && set +a` covers
// those). libgcits itself also reads GEMSTONE_GLOBAL_DIR (not VITE_-prefixed)
// directly via getenv to find the NetLDI socket -- without it, login fails
// with "NetLDI service ... not found" even though the service is up:
//   set -a && source client/.env.test && set +a
//   export GEMSTONE_GLOBAL_DIR="$VITE_GEMSTONE_GLOBAL_DIR"
//   ./repro

// gcits.hf uses time_t and size_t without including their headers itself,
// relying on whatever the including file already pulled in -- these two
// have to come first, or it fails to compile (seen on Linux/gcc; happened
// to already be visible by this point on macOS/clang).
#include <cstddef>
#include <ctime>

#include "gcits.hf"

#include <cstdio>
#include <cstdlib>
#include <string>

#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {

#if defined(_WIN32)
using LibHandle = HMODULE;
LibHandle loadLib(const char* path) {
  return LoadLibraryA(path);
}
void* sym(LibHandle lib, const char* name) {
  return reinterpret_cast<void*>(GetProcAddress(lib, name));
}
#else
using LibHandle = void*;
LibHandle loadLib(const char* path) {
  return dlopen(path, RTLD_NOW);
}
void* sym(LibHandle lib, const char* name) {
  return dlsym(lib, name);
}
#endif

using GciTsLoginFn = GciSession (*)(const char*, const char*, const char*, BoolType,
                                     const char*, const char*, const char*, unsigned int, int,
                                     BoolType*, GciErrSType*);
using GciTsNbExecuteFn = BoolType (*)(GciSession, const char*, OopType, OopType, OopType, int,
                                       ushort, GciErrSType*);
using GciTsLogoutFn = BoolType (*)(GciSession, GciErrSType*);
using GciTsNbPollFn = int (*)(GciSession, int, GciErrSType*);

const char* requireEnv(const char* name) {
  const char* value = std::getenv(name);
  if (!value || !value[0]) {
    std::fprintf(stderr, "%s is not set -- see this file's header comment for how to run it.\n",
                 name);
    std::exit(2);
  }
  return value;
}

void* requireSym(LibHandle lib, const char* name) {
  void* fn = sym(lib, name);
  if (!fn) {
    std::fprintf(stderr, "%s is not exported by this library.\n", name);
    std::exit(1);
  }
  return fn;
}

} // namespace

int main() {
  // Unbuffered: if this crashes, whatever was printed before the crash
  // should still show up in the output rather than being lost with the
  // buffer.
  std::setvbuf(stdout, nullptr, _IONBF, 0);

  const char* libPath = requireEnv("VITE_GEMSTONE_GCI_LIBRARY_PATH");
  const char* stoneNrs = requireEnv("VITE_GEMSTONE_STONE_NRS");
  const char* gemServiceNrs = requireEnv("VITE_GEMSTONE_GEM_NRS");
  const char* user = requireEnv("VITE_GEMSTONE_USER");
  const char* password = requireEnv("VITE_GEMSTONE_PASSWORD");

#if defined(__linux__)
  // libgcits has an undefined reference to HostCreateThread, defined in
  // libnetldi. dlopen defaults to RTLD_LOCAL, so libnetldi must be loaded
  // with RTLD_GLOBAL first to make that symbol visible when libgcits is
  // resolved. Mirrors gciLibrary.ts's constructor -- not needed on macOS or
  // Windows, whose dynamic linkers resolve this differently.
  std::string path(libPath);
  auto lastSlash = path.find_last_of('/');
  std::string dir = lastSlash == std::string::npos ? "." : path.substr(0, lastSlash);
  std::string file = lastSlash == std::string::npos ? path : path.substr(lastSlash + 1);
  auto prefixLen = std::string("libgcits-").size();
  std::string netldiPath = dir + "/libnetldi-" + file.substr(prefixLen);
  dlopen(netldiPath.c_str(), RTLD_NOW | RTLD_GLOBAL);
#endif

  LibHandle lib = loadLib(libPath);
  if (!lib) {
    std::fprintf(stderr, "failed to load %s\n", libPath);
    return 1;
  }

  auto gciTsLogin = reinterpret_cast<GciTsLoginFn>(requireSym(lib, "GciTsLogin"));
  auto gciTsNbExecute = reinterpret_cast<GciTsNbExecuteFn>(requireSym(lib, "GciTsNbExecute"));
  auto gciTsLogout = reinterpret_cast<GciTsLogoutFn>(requireSym(lib, "GciTsLogout"));

  // Optional: not exported before GemStone 3.7.0 -- nothing to repro there,
  // since GciLibrary falls back to a different (unaffected) poll path.
  auto gciTsNbPoll = reinterpret_cast<GciTsNbPollFn>(sym(lib, "GciTsNbPoll"));
  if (!gciTsNbPoll) {
    std::printf("GciTsNbPoll is not exported by this library -- nothing to repro here.\n");
    return 0;
  }

  GciErrSType loginErr;
  BoolType executedSessionInit = 0;
  GciSession session = gciTsLogin(stoneNrs, nullptr, nullptr, 0, gemServiceNrs, user, password,
                                   GCI_LOGIN_QUIET, 0, &executedSessionInit, &loginErr);
  if (!session) {
    std::fprintf(stderr, "login failed: [%d] %s\n", loginErr.number, loginErr.message);
    return 1;
  }
  std::printf("logged in\n");

  GciErrSType execErr;
  BoolType started = gciTsNbExecute(session, "(Delay forSeconds: 2) wait. true", OOP_CLASS_STRING,
                                     OOP_ILLEGAL, OOP_NIL, 0, 0, &execErr);
  if (!started) {
    std::fprintf(stderr, "GciTsNbExecute failed to start: [%d] %s\n", execErr.number,
                 execErr.message);
    return 1;
  }
  std::printf("started a non-blocking call\n");

  GciErrSType logoutErr;
  gciTsLogout(session, &logoutErr);
  std::printf("logged out while the call was still outstanding\n");

  // If GciTsNbPoll validated its session argument the way its own doc
  // comment promises ("-1 - error, invalid session..."), this would just
  // print -1. Instead it segfaults the process -- if you're reading this
  // from a crash (or a debugger), that's the repro reproducing.
  GciErrSType pollErr;
  int polled = gciTsNbPoll(session, 0, &pollErr);
  std::printf("GciTsNbPoll on a logged-out session returned: %d (err %d: %s)\n", polled,
              pollErr.number, pollErr.message);
  return 0;
}
