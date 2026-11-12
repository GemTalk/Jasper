import json,re,glob,sys,statistics as st,collections
from datetime import datetime as dt
O,N=sys.argv[1],sys.argv[2]
P=lambda s: dt.fromisoformat(s.replace('Z','+00:00')).timestamp()
runs={}
for fn in (O+'/health_runs.tsv',N+'/n2/runs.tsv'):
    for l in open(fn):
        a=l.rstrip('\n').split('\t'); runs[a[0]]=a
def excluded(b): return b.startswith('npapagna/wip') or b.startswith('throwaway') or b.startswith('wip/') or '/wip/' in b
dec=json.JSONDecoder(); seen=set(); legs=[]; runwall=collections.defaultdict(list)
byrun=collections.defaultdict(list)
for d in (O,N+'/n2'):
    for f in glob.glob(d+'/jobs/*.jsonl'):
        txt=open(f).read(); i=0
        while True:
            t2=txt[i:].lstrip()
            if not t2: break
            j,n=dec.raw_decode(t2); i=len(txt)-len(t2)+n
            if not(isinstance(j,dict) and j.get('id')) or j['id'] in seen: continue
            seen.add(j['id'])
            r=runs.get(str(j['run_id']))
            if not r or j['run_attempt']!=1 or excluded(r[4]): continue
            if not(j.get('started_at') and j.get('completed_at')): continue
            byrun[str(j['run_id'])].append(j)
            if j['conclusion']=='success' and re.match(r'(ubuntu|macos|windows)-latest \d',j.get('name') or ''):
                s={x['name']:P(x['completed_at'])-P(x['started_at']) for x in j['steps'] if x.get('completed_at') and x.get('started_at')}
                a=s.get('Run tests (without server plugin)'); b=s.get('Run tests (with server plugin)')
                if a is None or b is None: continue
                leg=P(j['completed_at'])-P(j['started_at'])
                legs.append((j['started_at'][:10],j['name'].split('-')[0],leg,a,b))
def med(x): return st.median(x) if x else None
def p90(x): x=sorted(x); return x[min(len(x)-1,int(len(x)*0.9))] if x else None
days=sorted({l[0] for l in legs})
out={'days':days,'platforms':{}}
for p in ['ubuntu','windows','macos']:
    rows=[]
    for d in days:
        v=[l for l in legs if l[0]==d and l[1]==p]
        if len(v)<3: rows.append(None); continue
        L=[x[2]/60 for x in v]; A=[x[3]/60 for x in v]; B=[x[4]/60 for x in v]
        rows.append({'n':len(v),'med':round(med(L),2),'p90':round(p90(L),2),'noplug':round(med(A),2),'plug':round(med(B),2),'setup':round(max(0,med(L)-med(A)-med(B)),2)})
    out['platforms'][p]=rows
# run wall time: green PR runs (all legs succeeded, run success, event pull_request, attempt 1)
wall=collections.defaultdict(list)
for rid,js in byrun.items():
    r=runs[rid]
    if r[3]!='pull_request' or r[5]!='success' or r[2]!='1': continue
    if not any(re.match(r'(ubuntu|macos|windows)-latest \d',j.get('name') or '') and j['conclusion']=='success' for j in js): continue
    w=(max(P(j['completed_at']) for j in js)-P(r[6]))/60
    wall[r[6][:10]].append(w)
out['wall']=[ ({'n':len(wall[d]),'med':round(med(wall[d]),2),'p90':round(p90(wall[d]),2)} if len(wall[d])>=3 else None) for d in days]
out['counts']={'legs':len(legs),'runs':sum(len(v) for v in wall.values())}
json.dump(out,open(N+'/chart_data.json','w'))
print(out['counts'],len(days),days[0],days[-1])
for p in out['platforms']:
    v=[r for r in out['platforms'][p] if r]; print(p,len(v),v[0]['med'],v[-1]['med'])
w=[x for x in out['wall'] if x]; print('wall',len(w),w[0]['med'],w[-1]['med'])
