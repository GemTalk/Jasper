#!/usr/bin/env bash
#
# Writes already-tested=true to $GITHUB_OUTPUT when a green PR run already
# tested this exact tree, so the merge queue may skip the tests. A wrong true
# merges untested code, a wrong false only costs a test run: every doubt ends
# in false, and the script never fails the job.
#
#   TREE=<tree hash> GH_TOKEN=<token> bash scripts/find-tested-tree.sh
#
# Same-repo authors are trusted: a PR's run executes the PR's own copy of the
# workflow, so it could record any tree.

set -uo pipefail

output="${GITHUB_OUTPUT:-/dev/stdout}"
repository="${GITHUB_REPOSITORY:-}"
repository_id="${GITHUB_REPOSITORY_ID:-}"
server_url="${GITHUB_SERVER_URL:-https://github.com}"
api_timeout="${GH_API_TIMEOUT_SECONDS:-15}"
# With one last 15 s call, well inside prepare's 3-minute limit in health-check.yml.
budget="${FIND_TESTED_TREE_BUDGET_SECONDS:-60}"

not_tested() {
  echo "$1"
  echo "already-tested=false" >>"$output"
  exit 0
}

# A hung call must not run prepare into its time limit, which would fail the
# run instead of only running the tests.
gh_api() {
  if command -v timeout >/dev/null; then
    timeout "$api_timeout" gh api "$@"
  else
    gh api "$@"
  fi
}

# TREE and the repository id are interpolated into jq filters below.
[[ "${TREE:-}" =~ ^[0-9a-f]{40}$ ]] || not_tested "No valid tree hash given, so running the tests."
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && "$repository_id" =~ ^[0-9]+$ ]] ||
  not_tested "GITHUB_REPOSITORY or GITHUB_REPOSITORY_ID is not set, so running the tests."
# A merge-queue ref names the PR it is testing: gh-readonly-queue/<base>/pr-<N>-<base sha>.
[[ "${GITHUB_REF:-}" =~ ^refs/heads/gh-readonly-queue/.+/pr-([0-9]+)-[0-9a-f]{40}$ ]] ||
  not_tested "This is not a merge-queue ref naming a PR, so running the tests."
pr_number="${BASH_REMATCH[1]}"

# The name check repeats the query's filter in case the API ignores it. A
# fork's run can upload any artifact name, so only this repository's count.
if ! run_ids=$(gh_api "repos/$repository/actions/artifacts?name=tested-tree-$TREE&per_page=100" \
  --jq "[.artifacts[]
          | select(.name == \"tested-tree-$TREE\"
                   and .expired == false
                   and .workflow_run.head_repository_id == $repository_id)
          | .workflow_run.id]
        | unique | .[]"); then
  not_tested "Could not look up tested-tree records, so running the tests."
fi

# The run must be a pull_request run of this workflow, for the PR being
# queued, and green now: an artifact outlives a later failed re-run.
expected=".github/workflows/health-check.yml pull_request success true"
for run_id in $run_ids; do
  ((SECONDS < budget)) || not_tested "Ran out of time checking tested-tree records, so running the tests."
  if ! origin=$(gh_api "repos/$repository/actions/runs/$run_id" \
    --jq "[.path, .event, .conclusion, ((.pull_requests // []) | any(.number == $pr_number) | tostring)]
          | map(. // \"\") | join(\" \")"); then
    continue
  fi
  if [ "$origin" = "$expected" ]; then
    run_url="$server_url/$repository/actions/runs/$run_id"
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
