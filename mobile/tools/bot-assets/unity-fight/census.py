"""Read a pinned Unity snapshot; produce explicit fight clip provenance. No editor or source mutation."""
import argparse,hashlib,json,pathlib,re,subprocess

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def states(path,guids):
 out={}
 for b in path.read_text().split('--- !u!1102 ')[1:]:
  n=re.search(r'  m_Name: (.*)',b);s=re.search(r'  m_Speed: ([^\n]+)',b);m=re.search(r'  m_Motion: \{[^\n]+guid: ([a-z0-9]+)',b)
  if n and m: out[n.group(1)]={'source':guids.get(m.group(1)),'speed':float(s.group(1)) if s else 1,'guid':m.group(1)}
 return out

def main():
 p=argparse.ArgumentParser();p.add_argument('--unity-root',required=True);p.add_argument('--output',required=True);a=p.parse_args();root=pathlib.Path(a.unity_root)
 guids={re.search(r'^guid: (.+)$',p.read_text(),re.M).group(1):str(p.with_suffix('').relative_to(root)) for p in root.rglob('*.meta') if re.search(r'^guid: (.+)$',p.read_text(),re.M)}
 config={'unityCommit':'1252e63acc6da12be0ab2cbdbde1408e2687251f','bots':{}}
 for c in root.rglob('*.controller'):
  bot='ace' if c.parent.name=='MixarTrial_20261008' else c.parent.name.lower()
  if bot=='jusan': continue # no bundled JUSAN model or mobile BotId; roster is deliberately unchanged.
  ss=states(c,guids);folder=c.parent
  moves={}
  mp=root/'Assets/Holobots/ACE/HB_ACE_MoveSet.asset' if bot=='ace' else next(folder.glob('*MoveSet.asset'),None)
  if mp:
   for block in mp.read_text().split('  - moveId: ')[1:]:
    name=block.splitlines()[0];state=re.search(r'animatorState:([^\n]*)',block).group(1).strip();rot=re.search(r'rotationStates:\s*\n    - (\w+)',block);trigger=re.search(r'animatorTrigger:([^\n]*)',block).group(1).strip();moves[name]=state or (rot.group(1) if rot else trigger)
  wanted={'FightLight':moves.get('attack_light','AttackBasic'),'FightHeavy':moves.get('break_heavy','CometCross'),'FightSpecial':moves.get('sky_launch','Skybreaker'),'FightHitLight':'HitLight','FightHitHeavy':'HitHeavy','FightGuard':moves.get('intercept','InterceptGuardXD'),'FightKO':'Defeat'}
  clips={}
  for name,state in wanted.items():
   row=ss.get(state)
   if not row or not row['source']: clips[name]={'state':state,'held':'unresolved controller motion','guid':row['guid'] if row else None};continue
   f=root/row['source'];txt=(f.with_suffix(f.suffix+'.meta') if f.suffix=='.fbx' else f).read_text();end=re.search(r'  m_StopTime: ([^\n]+)',txt);damage=re.search(r'  - time: ([^\n]+)\n    functionName: OnAnimationMarker\n    data: DamageFrame',txt)
   clips[name]={**row,'state':state,'sha256':sha(f),'duration':float(end.group(1)) if end else None,'contact':float(damage.group(1)) if damage else None}
   if f.suffix=='.fbx':
    clips[name].update(kind='fbx',take='Scene',duration=(float(re.search(r'lastFrame: ([^\n]+)',txt).group(1))-float(re.search(r'firstFrame: ([^\n]+)',txt).group(1)))/30)
  # Raw identical reference pose: HARE's installed Idle has its axis correction, so use its attack instead.
  refname='SnapKick' if bot=='hare' else 'JabCross' if bot=='ace' else 'HoverIdle' if bot=='wolf' else 'Idle'
  ref=next(folder.glob('HB_'+bot.upper()+'_Mixar_'+refname+'.anim'))
  idle=next(folder.glob('HB_'+bot.upper()+'_Mixar_'+('FableHover' if bot=='ace' else 'HoverIdle' if bot=='wolf' else 'Idle')+'.anim'))
  run=idle if bot=='ace' else next(folder.glob('HB_'+bot.upper()+'_Run.anim'),None) or next(folder.glob('HB_'+bot.upper()+'_Mixar_Run.anim'),None)
  for name,f in [('FightIdle',idle),('FightRun',run)]:
   if f:
    txt=f.read_text();end=re.search(r'  m_StopTime: ([^\n]+)',txt);clips[name]={'source':str(f.relative_to(root)),'sha256':sha(f),'state':name,'speed':1,'duration':float(end.group(1)) if end else None,'contact':None}
  if bot=='ace':
   clips['FightRun']['provenance']='Installed Hover locomotionMode=1 / groundedInCombat=0: CombatLocomotionHover.Forward uses BattleReady/FableHover. Legacy baked Run is an incompatible rig and is not used.'
  if bot=='tsuin':
   guard=pathlib.Path('/Users/pak/HolobotsVault/AnimationSources/2026-10-20-TSUIN-Guard/TSUIN_Guard_v1.fbx')
   clips['FightGuard']={'source':str(guard),'sha256':sha(guard),'kind':'fbx','take':'TSUIN_GuardHold','duration':1,'contact':None,'speed':1,'state':'vault-authored GuardHold; Unity installed fallback is AttackBasic','provenance':'2026-10-20-tsuin-guard-clips-1; native blend witness remains queued'}
  config['bots'][bot]={'reference':str(ref.relative_to(root)),'referenceSha256':sha(ref),'referenceTake':refname,'controller':str(c.relative_to(root)),'controllerSha256':sha(c),'clips':clips}
 pathlib.Path(a.output).write_text(json.dumps(config,indent=2)+'\n')
 print([(b,[k for k,v in x['clips'].items() if 'held'in v]) for b,x in config['bots'].items()])
if __name__=='__main__':main()
