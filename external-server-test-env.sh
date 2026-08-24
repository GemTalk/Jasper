# Setup for the "servers started outside Jasper" UI tests.
#
#   source ./external-server-test-env.sh
#
# Source this in EVERY terminal you use for these tests. The variables it sets
# do not survive a new terminal, and the failure mode when they are missing is
# quiet rather than loud: $DB expands to nothing, so `-l "$DB/log/x.log"`
# becomes `-l /log/x.log` and GemStone reports a missing directory instead of a
# missing variable.
#
# Safe to source more than once.

export ROOT=/uffda1/users/ewinger/jasperStones
export GS=$ROOT/GemStone64Bit3.7.5-x86_64.Linux
export DB=$ROOT/db-2
export OUTSIDE=/tmp/gemstone-outside

mkdir -p "$OUTSIDE/locks" "$OUTSIDE/log"

export GEMSTONE=$GS
export GEMSTONE_GLOBAL_DIR=$OUTSIDE    # the whole point: NOT $ROOT
export PATH=$GS/bin:$PATH

# This shell exports GEMSTONE_NRS_ALL='#dir:/export/uffda2/users/ewinger/logs'
# from ~/.bashrc, which startnetldi picks up and folds into its own NRS string.
# That is a real thing users have — and exactly what the "deterministic
# discovery environment" half of this issue is about — but it makes these tests
# depend on a directory that has nothing to do with them. Cleared here so a run
# is reproducible; Jasper's own behaviour with it set is covered by unit tests.
unset GEMSTONE_NRS_ALL

# Deliberately NOT set: GEMSTONE_SYS_CONF / GEMSTONE_EXE_CONF. Whether those are
# exported is what decides if Jasper can identify a server, so each test sets
# them (or does not) on purpose. See "How identity gets decided" in the plan.
unset GEMSTONE_SYS_CONF GEMSTONE_EXE_CONF

echo "outside-Jasper shell ready"
echo "  GEMSTONE            = $GEMSTONE"
echo "  GEMSTONE_GLOBAL_DIR = $GEMSTONE_GLOBAL_DIR"
echo "  DB                  = $DB"
echo

# Check the state rather than printing commands for the reader to run and
# interpret. The natural sanity check here is "gslist finds nothing", whose
# output is the word-for-word same as a real failure — so leaving it to the
# reader means a correct setup looks broken.
fail=0

if [ -d "$DB/conf" ] && [ -d "$DB/log" ]; then
  echo "  [ok]   \$DB points at a real database"
else
  echo "  [BAD]  \$DB=$DB has no conf/ and log/ — wrong path, or the variable is empty"
  fail=1
fi

# Data rows only: gslist's own chatter includes "No GemStone servers", which
# contains the word Stone and matched a looser test — the same class of mistake
# this check exists to spare the reader.
servers_in() { printf '%s\n' "$1" | grep -vE '^gslist\[' | grep -cE '[[:space:]](Stone|Netldi)[[:space:]]+[^[:space:]]+$' || true; }

outside=$("$GS/bin/gslist" -cvl 2>/dev/null || true)
if [ "$(servers_in "$outside")" -gt 0 ]; then
  echo "  [note] this shell already sees servers in $OUTSIDE:"
  printf '%s\n' "$outside" | sed 's/^/           /'
else
  echo "  [ok]   this shell sees no servers yet — expected, nothing started outside Jasper"
fi

jasper=$(GEMSTONE_GLOBAL_DIR="$ROOT" "$GS/bin/gslist" -cvl 2>/dev/null || true)
seen=$(servers_in "$jasper")
if [ "$seen" -gt 0 ]; then
  echo "  [ok]   Jasper's own gslist sees $seen server(s) in $ROOT — a different view, which is the point"
else
  echo "  [note] Jasper's gslist sees nothing either; fine if all your databases are stopped"
fi

if [ "$fail" -eq 0 ]; then
  echo
  echo "  ready — go start servers for the test"
else
  echo
  echo "  NOT ready — fix the above before starting anything"
fi
