#!/usr/bin/env python3
# Usage: ./gs-info.py <netldi-name>
#
# Prints "<ip> <port>" so a caller outside this machine's own network stack
# (e.g. a native Windows host reaching into the WSL guest this runs in) can
# connect to the NetLDI process named <netldi-name>. Neither 'localhost' nor
# NetLDI's name resolve from outside, so this reports this machine's real
# address and NetLDI's actual bound port instead.
#
# Exits 1 with an error on stderr (echoing gslist's own output) if no such
# server is running. Requires gslist on PATH.
#
# Python, not bash like the other gs-*.sh scripts: finding "this machine's
# own address" portably needs a real socket API. Bash has no built-in way to
# do that, and the OS-level fallback isn't portable either: `hostname -I`
# only exists on Linux (including the WSL guest this actually runs in), not
# on macOS, where a dev testing this locally would need something else
# entirely (e.g. `ipconfig getifaddr en0`). Python's socket module gives one
# implementation that works the same everywhere.

import json
import socket
import subprocess
import sys

def netldi_ip():
    # Doesn't actually send any packets (UDP connect() just picks a route):
    # this reads back whichever local address the OS would use to reach the
    # outside world, i.e. this machine's own address as seen from beyond its
    # network stack -- the same thing `hostname -I` plus IPv4/IPv6 filtering
    # was after.
    probe_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    probe_socket.connect(("8.8.8.8", 80))
    ip = probe_socket.getsockname()[0]
    probe_socket.close()
    return ip

def netldi_port(name):
    result = subprocess.run(
        [
          "gslist",
          # -j: JSON output, so the Port field is read by name instead of by
          # counting columns in gslist's fixed-width table
          "-j",
          # -c: clean up stale locks left by a killed server
          "-c",
          # -v: verify the server actually responds, not just that its lock file exists
          "-v",
          # -n: filter to this exact name, server-side
          "-n",
          # the NetLDI name -n is filtering on
          name
        ],
        capture_output=True,
        text=True
    )

    entries = None
    if result.returncode == 0:
        try:
            entries = json.loads(result.stdout)["GemStoneServers"]
        except (json.JSONDecodeError, KeyError):
            entries = None

    if not entries:
        print(f"Could not find a running Netldi named {name} in gslist output:", file=sys.stderr)
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    return entries[0]["Port"]

def main():
    name = sys.argv[1]
    print(netldi_ip(), netldi_port(name))

main()
