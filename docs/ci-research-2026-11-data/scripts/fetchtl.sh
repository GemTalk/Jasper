#!/bin/sh
D="$1"; id="$2"
[ -s "$D/tlogs/$id.log" ] || gh api "repos/GemTalk/Jasper/actions/jobs/$id/logs" > "$D/tlogs/$id.log" 2>/dev/null
