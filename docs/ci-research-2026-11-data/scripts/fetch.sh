#!/bin/sh
D="$1"; id="$2"
gh api --paginate "repos/GemTalk/Jasper/actions/runs/$id/jobs?filter=all&per_page=100" --jq '.jobs[]|{run_id,id,name,run_attempt,conclusion,started_at,completed_at,steps:[.steps[]|{name,conclusion,started_at,completed_at}]}' > "$D/jobs/$id.jsonl" 2>>"$D/err.txt"
