#!/bin/sh
D="$1"; id="$2"
[ -s "$D/q/$id.json" ] || gh api --paginate "repos/GemTalk/Jasper/actions/runs/$id/jobs?filter=latest&per_page=100" --jq '.jobs[]|[.id,.run_id,.name,.created_at,.started_at,.completed_at,.conclusion,.runner_name,.labels[0]]|@tsv' > "$D/q/$id.json" 2>/dev/null
