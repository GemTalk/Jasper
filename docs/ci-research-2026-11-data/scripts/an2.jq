def s(a;b): if a and b then ((b|fromdateiso8601)-(a|fromdateiso8601)) else null end;
def med: sort|if length==0 then null else .[length/2|floor] end;
def plat: (.name|capture("^(?<p>ubuntu|macos|windows)").p);
[ .[] | select((.name//"")|test("^(ubuntu|macos|windows)-latest [0-9]")) | select(.conclusion=="success") | plat as $p | .steps[] | select(.conclusion=="success") | {p:$p, step:.name, d:s(.started_at;.completed_at)} ]
| group_by([.p,.step]) | map({p:.[0].p,step:.[0].step,n:length,med:(map(.d)|med),tot:(map(.d)|add)})
| map(select(.med>=5)) | sort_by(.p,-.med) | .[] | [.p,.step,.n,.med,(.tot/3600|.*10|round/10)]|@tsv
