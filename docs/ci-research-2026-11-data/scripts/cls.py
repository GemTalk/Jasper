import re,sys,glob,os,collections
fs={l.split('\t')[0]:l.rstrip('\n').split('\t')[1] for l in open('failstep.tsv')}
pats=[('timeout_exceeded',r'exceeded the maximum execution time'),
('runner_lost',r'runner has received a shutdown signal|lost communication with the server|operation was canceled'),
('vitest_fail',r'(?m)^\S*\s*(FAIL|❯ .*\.test\.ts|×)\s'),
('timed_out_test',r'Test timed out|Hook timed out|timed out in \d+ms'),
('gci_error',r'GciError|GciLibraryError|GCI '),]
rows=[]
for p in sorted(glob.glob('logs/*.log')):
    jid=os.path.basename(p)[:-4]
    t=open(p,errors='replace').read().replace('\r','')
    rows.append((jid,fs.get(jid),len(t),[n for n,r in pats if re.search(r,t)]))
c=collections.Counter((r[1],tuple(r[3])) for r in rows)
for k,v in c.most_common(): print(v,k)
