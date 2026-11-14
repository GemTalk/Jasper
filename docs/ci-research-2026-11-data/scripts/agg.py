import json,collections,re,glob
F=json.load(open('fails.json'))
# all leg outcomes by (run,attempt,leg)
out={}
dec=json.JSONDecoder()
for f in glob.glob('jobs/*.jsonl'):
    txt=open(f).read(); i=0
    while True:
        t2=txt[i:].lstrip()
        if not t2: break
        j,n=dec.raw_decode(t2); i=len(txt)-len(t2)+n
        if isinstance(j,dict) and j.get('name') and re.match(r'(ubuntu|macos|windows)-latest \d',j['name']):
            out[(str(j['run_id']),j['run_attempt'],j['name'])]=j['conclusion']
by=collections.defaultdict(list)
for o in F:
    for f in o['fails']: by[(f[0],f[1])].append((o,f[2]))
rows=[]
for (file,name),L in by.items():
    jobs=len(L); runs={(o['run']) for o,_ in L}
    ra={(o['run'],o['attempt']) for o,_ in L}
    # partial: same run-attempt had some completed legs (success) while this test failed in other leg
    partial=0; rerun_pass=0; solo=0
    for r,a in ra:
        legs={k[2]:v for k,v in out.items() if k[0]==r and k[1]==a}
        failing={o['leg'] for o,_ in L if o['run']==r and o['attempt']==a}
        ok=[l for l,v in legs.items() if v=='success']
        if ok: partial+=1
    for o,_ in L:
        if out.get((o['run'],o['attempt']+1,o['leg']))=='success' or any(out.get((o['run'],a,o['leg']))=='success' for a in range(o['attempt']+1,6)): rerun_pass+=1
    ev=collections.Counter(o['event']+('/main' if o['branch']=='main' else '') for o,_ in L)
    legs=collections.Counter(o['leg'].split()[0] for o,_ in L)
    errs=collections.Counter(e for _,e in L if e).most_common(1)
    rows.append((jobs,len(runs),partial,rerun_pass,file.split('/')[-1],name[:110],dict(ev),dict(legs),errs[0][0][:100] if errs else ''))
rows.sort(reverse=True)
json.dump(rows,open('agg.json','w'))
for r in rows[:70]: print(r)
print(len(rows))
