from pathlib import Path
import hashlib,json,subprocess
root=Path(__file__).resolve().parents[3]
controls=[
 ('local-copy','mobile/src/lib/story/storyFlags.ts','return { ...state.flags };','return state.flags;','src/lib/story/__tests__/storyFlags.test.ts','getFlags returns a defensive copy'),
 ('rival-remaining-time','functions/src/lib/rivalLadder.ts','const retryAfterMs = at + RIVAL_COOLDOWN_MS - nowMs;','const retryAfterMs = at + RIVAL_COOLDOWN_MS - nowMs + 1;','src/lib/__tests__/rivalCooldownContract.test.ts','reports the exact positive retryAfterMs'),
 ('desktop-default','functions/src/story/storyFlags.ts','tournamentsWon: s?.tournamentsWon ?? 0,','tournamentsWon: s?.tournamentsWon ?? 1,','src/lib/__tests__/desktopStoryFlagsParity.test.ts','defaults all four fields'),
]
branch=subprocess.check_output(['git','branch','--show-current'],cwd=root,text=True).strip()
if branch in ['', 'main', 'master']:
    raise SystemExit('Run mutation controls only in an isolated task branch/worktree')
for _,rel,*_ in controls:
    if subprocess.check_output(['git','status','--porcelain','--',rel],cwd=root,text=True).strip():
        raise SystemExit('Refusing to mutate a dirty source path: '+rel)
results=[]
for name,rel,before,after,test,pattern in controls:
    path=root/rel; original=path.read_bytes(); text=original.decode()
    if text.count(before)!=1:raise RuntimeError('mutation anchor must be unique: '+name)
    try:
        path.write_text(text.replace(before,after))
        run=subprocess.run(['./node_modules/.bin/vitest','run',test,'-t',pattern],cwd=root/'mobile',stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=120)
        Path('/private/tmp/mobile-mutation-'+name+'.log').write_text(run.stdout)
        results.append({'control':name,'source':rel,'mutation':{'before':before,'after':after},'test':test,'testNamePattern':pattern,'exitCode':run.returncode,'assertionFailure':('AssertionError' in run.stdout),'sourceSha256':hashlib.sha256(original).hexdigest()})
    finally:
        path.write_bytes(original)
    results[-1]['restoredSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    print(json.dumps(results[-1]),flush=True)
Path('/private/tmp/mobile-mutation-results.json').write_text(json.dumps(results,indent=2)+'\n')
if not all(r['exitCode']==1 and r['assertionFailure'] and r['sourceSha256']==r['restoredSha256'] for r in results):raise SystemExit('CONTROL ERROR: expected assertion failure and exact restoration')
