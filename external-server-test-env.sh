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
echo "  GEMSTONE_GLOBAL_DIR = $GEMSTONE_GLOBAL_DIR   (Jasper looks in $ROOT)"
echo "  DB                  = $DB"
echo
echo "sanity check:"
echo "  gslist -cvl                            # should be empty"
echo "  GEMSTONE_GLOBAL_DIR=\$ROOT gslist -cvl  # should show db-1's servers"
