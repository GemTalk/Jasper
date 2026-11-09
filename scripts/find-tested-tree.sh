#!/usr/bin/env bash
#
# Decides whether a merge-queue run may skip the tests: it may when a green
# Health Check run of a PR already tested the exact tree the queue is about to
# test. That PR run's ci-complete uploaded an artifact named
# tested-tree-<tree hash> (see health-check.yml).
#
# Writes already-tested=true or already-tested=false to $GITHUB_OUTPUT. Every
# doubt ends in false: no record, an expired one, an untrusted one, or any API
# error. A wrong false costs a full test run; a wrong true would merge untested
# code, so this script never fails the job and never guesses true.
#
#   TREE=<tree hash> GH_TOKEN=<token> bash scripts/find-tested-tree.sh
#
# Also reads GITHUB_REPOSITORY and GITHUB_REPOSITORY_ID, which Actions sets.

set -uo pipefail

output="${GITHUB_OUTPUT:-/dev/stdout}"

not_tested() {
  echo "$1"
  echo "already-tested=false" >>"$output"
  exit 0
}

[[ "${TREE:-}" =~ ^[0-9a-f]{40}$ ]] || not_tested "No valid tree hash given, so running the tests."

# Only records from runs of this repository count. A fork's PR run executes
# the fork's own copy of the workflow and can upload any artifact name.
if ! run_ids=$(gh api "repos/$GITHUB_REPOSITORY/actions/artifacts?name=tested-tree-$TREE&per_page=100" \
  --jq "[.artifacts[]
          | select(.expired == false and .workflow_run.head_repository_id == $GITHUB_REPOSITORY_ID)
          | .workflow_run.id]
        | unique | .[]"); then
  not_tested "Could not look up tested-tree records, so running the tests."
fi

# Also require that the record came from a pull_request run of this workflow,
# not from some other workflow that happened to upload the same name.
for run_id in $run_ids; do
  if ! origin=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id" --jq '.path + " " + .event'); then
    continue
  fi
  if [ "$origin" = ".github/workflows/health-check.yml pull_request" ]; then
    run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$run_id"
    # The notice shows under the run graph, where the skipped jobs alone are
    # just grey icons. A colon would end the title early, so it has none.
    echo "::notice title=Tests skipped because this exact code already passed::$run_url tested the same files (tree $TREE), so this merge-queue run did not run the tests again."
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      printf '### Tests skipped: this exact code already passed\n\n[This PR run](%s) tested the same files (tree `%s`), so this merge-queue run did not run the tests again.\n' \
        "$run_url" "$TREE" >>"$GITHUB_STEP_SUMMARY"
    fi
    echo "already-tested=true" >>"$output"
    exit 0
  fi
done

not_tested "No green PR run of tree $TREE found, so running the tests."
