import re,glob,json,collections,sys,statistics as st
from datetime import date
wk=sys.argv[1]; out=sys.argv[2]
ansi=re.compile(r'\x1b\[[0-9;]*m')
files=collections.defaultdict(lambda:collections.defaultdict(int))   # (w,p)->file->ms (both runs)
tests=collections.defaultdict(lambda:collections.defaultdict(list))  # (w,p)->(file,name)->[ms per run]
for f in glob.glob(wk+'/*.log'):
    w,p=f.split('/')[-1][:-4].split('_'); w=int(w); cur=None
    for x in ansi.sub('',open(f,errors='replace').read().replace('\r','')).split('\n'):
        x=re.sub(r'^\S+Z ','',x)
        m=re.search(r'[✓❯]\s+default\s+(\S+\.test\.ts)\s+\((\d+) tests?.*?\)\s+(\d+)ms',x)
        if m: cur=m.group(1).split('/')[-1]; files[(w,p)][cur]+=int(m.group(3)); continue
        m=re.match(r'\s{4,}[✓×]\s+(.*?)\s+(\d+)ms$',x)
        if m and cur: tests[(w,p)][(cur,m.group(1))].append(int(m.group(2)))
weeks=sorted({k[0] for k in files}); plats=['ubuntu','windows','macos']
short=lambda s: s.replace('.integration.test.ts','').replace('.test.ts','')
tot=collections.Counter()
for (w,p),d in files.items():
    for k,v in d.items(): tot[k]+=v
top=[k for k,_ in tot.most_common(8)]
rows=[]
for w in weeks:
    start=date.fromisocalendar(2026,w,1).isoformat()
    for p in plats:
        d=files[(w,p)]; rest=sum(v for k,v in d.items() if k not in top)
        for k in top: rows.append({'week':start,'platform':p,'file':short(k),'seconds':round(d.get(k,0)/1000,1)})
        rows.append({'week':start,'platform':p,'file':'Other files','seconds':round(rest/1000,1)})
json.dump(rows,open(out+'/ci_files_weekly.json','w'))
# platform differences, latest week
w=weeks[-1]; diff=[]
allf=set().union(*[set(files[(w,p)]) for p in plats])
for k in allf:
    v={p:files[(w,p)].get(k,0)/1000 for p in plats}
    mx,mn=max(v.values()),min(v.values())
    if mx>=10 and (mx-mn)/mx>0.2: diff.append({'file':short(k),'ubuntu_s':round(v['ubuntu']),'windows_s':round(v['windows']),'macos_s':round(v['macos']),'spread_s':round(mx-mn)})
diff.sort(key=lambda r:-r['spread_s']); json.dump(diff,open(out+'/ci_platform_diff.json','w'))
# slowest individual tests, latest week, mean per run, mean across platforms
cand=collections.defaultdict(dict)
for p in plats:
    for k,l in tests[(w,p)].items(): cand[k][p]=st.mean(l)/1000
sl=[]
for k,v in cand.items():
    sl.append({'file':short(k[0]),'test':k[1][:95],'ubuntu_s':round(v.get('ubuntu',0),1),'windows_s':round(v.get('windows',0),1),'macos_s':round(v.get('macos',0),1),'mean_s':round(st.mean(v.values()),1)})
sl.sort(key=lambda r:-r['mean_s']); sl=sl[:10]
json.dump(sl,open(out+'/ci_slowest_tests.json','w'))
print('weeks',weeks,'top',[short(k) for k in top]); print(len(rows),len(diff),len(sl))
for r in diff: print(r)
for r in sl: print(r['mean_s'],r['file'],r['test'][:60])
