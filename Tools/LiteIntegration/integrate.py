"""Deterministic presentation isolation from the pinned merge; no git mutation."""
import subprocess,json,re,posixpath,hashlib
from pathlib import Path
R=Path('/private/tmp/astra-mobile-session'); MAIN='35f8f70a6dc5994aa0d62da63b70bfff91aebfaa'; LITE='51abaa9e79013005570bec6c31f34b2ed11f7f3b'
def git(*a):return subprocess.check_output(['git','-C',str(R),*a],text=True)
assert R.resolve() == Path("/private/tmp/astra-mobile-session"), "Refuse a different checkout"
assert git("branch", "--show-current").strip() == "codex/lite-main-integration-1", "Refuse foreign branch"
assert git("rev-parse", "HEAD").strip() == MAIN and git("rev-parse", "MERGE_HEAD").strip() == LITE, "Requires fresh pinned merge"
assert not (R / "mobile/src/lite").exists(), "Refuse rerun over generated candidate"
files=[x for x in git('ls-tree','-r','--name-only',LITE,'mobile/src').splitlines() if x.endswith(('.ts','.tsx','.json'))]
allfiles=set(files);sources={p:(R/p).read_text() for p in files};mainfiles=set(git('ls-tree','-r','--name-only',MAIN,'mobile/src').splitlines())
shared={'mobile/src/contexts/AuthContext.tsx','mobile/src/config/firebase.ts','mobile/src/config/holobots.ts','mobile/src/lib/profile.ts','mobile/src/types/profile.ts','mobile/src/lib/cityHub.ts'}
pattern=r'((?:from\s*|require\s*\(\s*|import\s*\(\s*)[\"\'])([^\"\']+)([\"\'])'
def resolve(p,s):
 if s.startswith('@/'):q='mobile/src/'+s[2:]
 elif s.startswith('.'):q=posixpath.normpath(posixpath.join(posixpath.dirname(p),s))
 else:return None
 for t in [q,q+'.ts',q+'.tsx',q+'.json',q+'/index.ts',q+'/index.tsx']:
  if t in allfiles:return t
 return q
imports={p:{resolve(p,m[1]) for m in re.findall(pattern,re.sub(r'(?:import|export)\s+type\s+.*?;', '',src,flags=re.S))} for p,src in sources.items()}
seed=set(git('diff','--name-only',MAIN+'...'+LITE,'--','mobile/src').splitlines())&allfiles-shared
closure=set(seed)
while True:
 add={p for p,deps in imports.items() if deps&closure and p not in shared}-closure
 if not add:break
 closure|=add
mapping={p:p.replace('mobile/src/','mobile/src/lite/',1) for p in closure}
def rewrite(src,old,new):
 def sub(m):
  spec=m[2];target=resolve(old,spec)
  if target is None:return m[0]
  if target=='mobile/App':target='mobile/LiteApp'
  dest=mapping.get(target,target)
  if spec.startswith('@/'):out='@/'+dest.removeprefix('mobile/src/')
  else:
   out=posixpath.relpath(dest,posixpath.dirname(new));out=out if out.startswith('.') else './'+out
  if not spec.endswith(('.ts','.tsx','.json')):out=re.sub(r'\.(?:tsx|ts)$','',out)
  return m[1]+out+m[3]
 return re.sub(pattern,sub,src)
manifest=[]
for old,new in sorted(mapping.items()):
 out=R/new;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(rewrite(sources[old],old,new))
 manifest.append({'source':old,'destination':new,'mergedSourceSha256':hashlib.sha256(sources[old].encode()).hexdigest(),'existedOnMain':old in mainfiles})
 if old in mainfiles:(R/old).write_text(git('show',MAIN+':'+old))
 else:(R/old).unlink()
app=(R/'mobile/App.tsx').read_text();(R/'mobile/LiteApp.tsx').write_text(rewrite(app,'mobile/App.tsx','mobile/LiteApp.tsx'));mainapp=git('show',MAIN+':mobile/App.tsx');(R/'mobile/MainApp.tsx').write_text(mainapp)
# Newly added tests for shared pure modules stay at their source paths and use shared seams.
q=R/'Documentation/QA/2026-10-17-lite-main-integration-1';q.mkdir(parents=True,exist_ok=True)
(q/'isolation-manifest.json').write_text(json.dumps({'main':MAIN,'lite':LITE,'shared':sorted(shared),'mainAppSha256':hashlib.sha256(mainapp.encode()).hexdigest(),'modules':manifest},indent=2)+'\n')
print('Isolated',len(mapping),'modules;',sum('/__tests__/' not in p for p in mapping),'runtime')
