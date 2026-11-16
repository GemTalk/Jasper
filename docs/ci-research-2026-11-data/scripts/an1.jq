def s(a;b): if a and b then ((b|fromdateiso8601)-(a|fromdateiso8601)) else null end;
def leg: select((.name//"")|test("^(ubuntu|macos|windows)-latest [0-9]"));
def med: sort|if length==0 then null else .[length/2|floor] end;
def p90: sort|if length==0 then null else .[(length*0.9)|floor] end;
def m: ./60|.*10|round/10;
[ .[] | leg | select(.conclusion=="success") | . + {dur:s(.started_at;.completed_at)} ]
| group_by(.name) | map({name:.[0].name,n:length,med:((map(.dur)|med)|m),p90:((map(.dur)|p90)|m),max:((map(.dur)|max)|m)})
| .[] | [.name,.n,.med,.p90,.max]|@tsv
