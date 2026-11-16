#!/bin/sh
D="$1"; id="$2"
[ -s "$D/logs/$id.log" ] || gh api "repos/GemTalk/Jasper/actions/jobs/$id/logs" > "$D/logs/$id.log" 2>>"$D/logerr.txt"
