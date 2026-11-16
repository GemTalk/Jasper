import re,glob,os,json
ansi=re.compile(r'\x1b\[[0-9;]*m')
runs={l.split('\t')[0]:l.rstrip('\n').split('\t') for l in open('health_runs.tsv')}
jobs={}
for f in glob.glob('jobs/*.jsonl'):
    txt=open(f).read(); dec=json.JSONDecoder(); i=0
    while True:
        txt2=txt[i:].lstrip()
        if not txt2: break
        j,n=dec.raw_decode(txt2); i=len(txt)-len(txt2)+n; (jobs.__setitem__(str(j['id']),j) if isinstance(j,dict) and j.get('id') else None)
fs={l.split('\t')[0]:l.rstrip('\n').split('\t')[1] for l in open('failstep.tsv')}
out=[]
for p in glob.glob('logs/*.log'):
    jid=os.path.basename(p)[:-4]; j=jobs[jid]
    t=ansi.sub('',open(p,errors='replace').read().replace('\r','')).split('\n')
    t=[re.sub(r'^\S+Z ','',l) for l in t]
    fails=[]; 
    for i,l in enumerate(t):
        m=re.match(r'\s*FAIL\s+(\S+)\s+(\S+\.test\.ts) > (.*)$',l)
        if m:
            err=''
            for k in range(i+1,min(i+12,len(t))):
                if re.match(r'\s*(\w*Error|Error)\b.*:|\s*Error:',t[k]) or 'Error' in t[k][:40]:
                    err=t[k].strip()[:160]; break
            fails.append((m.group(2),m.group(3).strip()[:200],err))
    seen={}; 
    for f in fails: seen.setdefault((f[0],f[1]),f)
    r=runs[str(j['run_id'])]
    out.append(dict(job=jid,run=str(j['run_id']),attempt=j['run_attempt'],leg=j['name'],step=fs[jid],event=r[3],branch=r[4],created=r[6],fails=list(seen.values()),
      timeout=any('timed out' in l for l in t), logtail=[l.strip()[:200] for l in t if '##[error]' in l][:2]))
json.dump(out,open('fails.json','w'))
print(len(out), sum(1 for o in out if o['fails']))
