# per run: attempts, failed legs per attempt, later success of same leg
def leg: select((.name//"")|test("^(ubuntu|macos|windows)-latest [0-9]"));
[ .[] | leg ] | group_by(.run_id) | map(
  . as $js | ($js|map(.run_attempt)|max) as $maxa |
  [ $js[] | select(.conclusion=="failure") | . as $f |
    {run:$f.run_id, leg:$f.name, attempt:$f.run_attempt, job:$f.id,
     later_ok: ([ $js[] | select(.name==$f.name and .run_attempt>$f.run_attempt and .conclusion=="success") ]|length>0)} ]
) | flatten | .[] | [.run,.attempt,.leg,.job,.later_ok]|@tsv
