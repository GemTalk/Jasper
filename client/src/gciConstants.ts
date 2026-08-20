// OOP tag bits (from gcioop.ht)
export const OOP_NUM_TAG_BITS = 3;
export const OOP_TAG_SMALLINT = 0x2;
export const OOP_TAG_SMALLDOUBLE = 0x6;
export const OOP_TAG_SPECIAL = 0x4;

// Well-known OOP values (from gcioop.ht)
export const OOP_ILLEGAL = 0x01n;
export const OOP_NIL = 0x14n;
export const OOP_FALSE = 0x0cn;
export const OOP_TRUE = 0x10cn;
export const OOP_ASCII_NUL = 0x1cn;

// SmallInteger OOPs (computed via GCI_I32_TO_OOP macro)
export const OOP_Zero = 0x02n;
export const OOP_One = 0x0an;
export const OOP_Two = 0x12n;
export const OOP_Three = 0x1an;
export const OOP_Four = 0x22n;

// Perform flags (from gcicmn.ht)
export const GCI_PERFORM_FLAG_ENABLE_DEBUG = 1;
// Place a single-step breakpoint at the start of the executed code and run to
// it, so execution halts on the first statement (Pharo-style "Debug It").
// Implies GCI_PERFORM_FLAG_INTERPRETED (native code off, required for stepping).
export const GCI_PERFORM_FLAG_SINGLE_STEP = 4;
// Run the execution interpreted (native code off). GemStone cannot single-step
// native code (error 6014) and a process must START interpreted to be
// steppable, so every execution that may end up in the debugger passes this.
// No effect where native code is unavailable anyway (e.g. Darwin/ARM builds).
export const GCI_PERFORM_FLAG_INTERPRETED = 0x20;

// Login flags (from gci.ht)
// Tells GciTsLogin the `gemstonePassword` argument is already ciphertext, as produced by
// GciTsEncrypt, rather than plaintext.
export const GCI_LOGIN_PW_ENCRYPTED = 0x1;

// Suppresses libgcits' unsolicited ` gcits login:` / ` gcits logout:` printf()s
// to stdout, which are the majority of the test suite's output and bypass the
// JS console entirely. Present with this value since 3.6.2, so no version
// gating is needed.
export const GCI_LOGIN_QUIET = 0x10;

// Class OOPs (from gcioop.ht)
export const OOP_CLASS_STRING = 74753n;
export const OOP_CLASS_UTF8 = 154113n;
export const OOP_CLASS_BOOLEAN = 68097n;
export const OOP_CLASS_CHARACTER = 68353n;
export const OOP_CLASS_SMALL_INTEGER = 74241n;
export const OOP_CLASS_UNDEFINED_OBJECT = 76289n;
export const OOP_CLASS_SMALL_DOUBLE = 121345n;
