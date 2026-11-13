#!/bin/sh
[ -s "$1/olog/$2.log" ] || gh api "repos/GemTalk/Jasper/actions/jobs/$2/logs" > "$1/olog/$2.log" 2>/dev/null
