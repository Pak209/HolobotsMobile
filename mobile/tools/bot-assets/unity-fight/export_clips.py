"""Blender 5.2: bake installed Unity fight curves onto the existing mobile GLB rig.
Inputs are pinned in census.json; mesh topology/textures are retained; skin weights are clamped to two.
Installed Unity curves are the motion authority. Calibration uses an existing shared take,
then held-out keys of that take test the Unity->Blender basis independently of the reference key.
No Unity invocation. Run with -- --bot wolf --source-root ... --input ... --config ... --output ...
"""
import argparse,hashlib,itertools,json,math,pathlib,re,sys
import bpy,numpy as np
from mathutils import Matrix
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from curve_guard import guard_curves

def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def parse(path):
 txt=pathlib.Path(path).read_text();out={}
 for sec,kind in [('m_RotationCurves','q'),('m_PositionCurves','p'),('m_ScaleCurves','s')]:
  i=txt.index('  '+sec+':');j=txt.index('\n  m_',i+10)
  for block in txt[i:j].split('\n  - curve:')[1:]:
   name=re.search(r'\n    path: (.*)',block).group(1).strip();keys=[]
   for m in re.finditer(r'time: ([-0-9.eE]+)\n\s+value: \{([^}]*)\}\n\s+inSlope: \{([^}]*)\}\n\s+outSlope: \{([^}]*)\}',block):
    vals=[]
    for s in m.groups()[1:]:
     d={k.strip():float(v) for k,v in (p.split(':') for p in s.split(','))};vals.append([d[k] for k in ('x','y','z','w') if k in d])
    keys.append((float(m.group(1)),*vals))
   out.setdefault(name,{})[kind]=keys
 return out

def sample(keys,t):
 times=np.array([k[0] for k in keys]);i=int(np.searchsorted(times,t,'right'))-1
 if i<0:return np.array(keys[0][1])
 if i>=len(keys)-1:return np.array(keys[-1][1])
 a,b=keys[i:i+2];dt=b[0]-a[0];u=(t-a[0])/dt
 # Unity's unweighted Hermite transform curve. Quaternion component curves are normalized by FK.
 return (2*u**3-3*u*u+1)*np.array(a[1])+(u**3-2*u*u+u)*dt*np.array(a[3])+(-2*u**3+3*u*u)*np.array(b[1])+(u**3-u*u)*dt*np.array(b[2])

def rotation(q):
 x,y,z,w=q/np.linalg.norm(q)
 return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
def polar(x):
 u,s,v=np.linalg.svd(x);r=u@v
 if np.linalg.det(r)<0:u[:,-1]*=-1;r=u@v
 return r

def fk(curves,t,defaults=None):
 curves={k:{**(defaults or {}).get(k,{}),**v} for k,v in {**(defaults or {}),**curves}.items()};out={}
 for p in sorted(curves,key=lambda x:x.count('/')):
  q=curves[p]
  if not q.get('p') or not q.get('q'):continue
  m=np.eye(4);m[:3,:3]=rotation(sample(q['q'],t))@np.diag(sample(q['s'],t) if q.get('s') else np.ones(3));m[:3,3]=sample(q['p'],t)
  parent=p.rsplit('/',1)[0] if '/'in p else None;out[p]=out[parent]@m if parent in out else m
 return {p.split('/')[-1]:m for p,m in out.items()}

def fit(up,bp):
 best=None
 for perm in itertools.permutations(range(3)):
  for sign in itertools.product((1.,-1.),repeat=3):
   a=np.zeros((3,3))
   for i in range(3):a[i,perm[i]]=sign[i]
   p=up@a.T;pc=p-p.mean(0);bc=bp-bp.mean(0);s=float((pc*bc).sum()/max((pc*pc).sum(),1e-12))
   if s<=0:continue
   tr=bp.mean(0)-s*p.mean(0);err=float(np.linalg.norm(s*p+tr-bp,axis=1).max())
   if best is None or err<best[0]:best=(err,a,s,tr)
 return best

def use_action(arm,action):
 arm.animation_data_create();arm.animation_data.action=action
 if action.slots:arm.animation_data.action_slot=next((s for s in action.slots if s.target_id_type=='OBJECT'),action.slots[0])

def main():
 p=argparse.ArgumentParser();p.add_argument('--bot',required=True);p.add_argument('--source-root',required=True);p.add_argument('--input',required=True);p.add_argument('--config',required=True);p.add_argument('--output',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);root=pathlib.Path(a.source_root);conf=json.load(open(a.config))['bots'][a.bot]
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=a.input);sc=bpy.context.scene
 arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');bones=list(arm.data.bones);names=[b.name for b in bones];parents={b.name:b.parent.name if b.parent else None for b in bones};rest={b.name:b.matrix_local.copy() for b in bones}
 original_actions={x.name:x for x in bpy.data.actions};ref_action=original_actions[conf['referenceTake']]
 for o in bpy.data.objects:
  if o.animation_data:
   for track in list(o.animation_data.nla_tracks):o.animation_data.nla_tracks.remove(track)
 use_action(arm,ref_action);ref_start=float(ref_action.frame_range[0]);sc.frame_set(int(ref_start),subframe=ref_start%1);bpy.context.view_layer.update();bref={b.name:np.array(arm.pose.bones[b.name].matrix) for b in bones}
 ref_path=root/conf['reference'];assert sha(ref_path)==conf['referenceSha256'];ref=parse(ref_path);guard_curves(ref_path.read_text(), ref_path.read_text());uref=fk(ref,0)
 assert set(names)<=set(uref),(set(names)-set(uref))
 err,axis,scale,tr=fit(np.array([uref[n][:3,3] for n in names]),np.array([bref[n][:3,3] for n in names]));assert err<0.01,('reference fit metres',err)
 refrot={n:polar(uref[n][:3,:3]) for n in names};brefrot={n:polar(bref[n][:3,:3]) for n in names}
 def convert(w):
  out={}
  for n in names:
   m=np.eye(4);m[:3,:3]=axis@polar(w[n][:3,:3])@refrot[n].T@axis.T@brefrot[n];m[:3,3]=scale*(axis@w[n][:3,3])+tr;out[n]=m
  return out
 # Same take at three held-out native-key times: compare relative bone pose to avoid Unity's grounded root-Y offset.
 world_units=float(max(arm.matrix_world.to_scale()));checks=[];source_fps=sc.render.fps/sc.render.fps_base;span=float(ref_action.frame_range[1]-ref_start)
 for fraction in [0.25,0.5,0.75]:
  offset=round(span*fraction);sc.frame_set(int(ref_start+offset),subframe=(ref_start+offset)%1);bpy.context.view_layer.update();b={n:np.array(arm.pose.bones[n].matrix) for n in names};u=convert(fk(ref,offset/source_fps));anchor='Hips'
  pos=max(np.linalg.norm((b[n][:3,3]-b[anchor][:3,3])-(u[n][:3,3]-u[anchor][:3,3])) for n in names)
  rot=max(math.degrees(math.acos(float(np.clip((np.trace(polar(b[n][:3,:3]).T@polar(u[n][:3,:3]))-1)/2,-1,1)))) for n in names)
  checks.append({'nativeFrame':offset,'positionMm':pos*1000*world_units,'rotationDeg':rot})
 # Preserve the original mobile takes on the identical imported rig. Convert their key frame numbers
 # to the common 120Hz bake timebase without changing seconds or their first-key offset.
 old_fps=sc.render.fps/sc.render.fps_base
 for ac in original_actions.values():
  ac.use_fake_user=True
  for layer in ac.layers:
   for strip in layer.strips:
    for bag in strip.channelbags:
     for curve in bag.fcurves:
      for key in curve.keyframe_points:
       key.co.x*=120/old_fps;key.handle_left.x*=120/old_fps;key.handle_right.x*=120/old_fps
       # Float32 glTF times can put a native 30Hz endpoint just below frame216.
       # Snap only near-integer common-timebase keys; otherwise Blender floors the final sample.
       if abs(key.co.x-round(key.co.x))<.001:key.co.x=round(key.co.x)
 arm.animation_data_clear()
 rows=[];curve_guards={};sc.render.fps=120
 for clip,entry in conf['clips'].items():
  if 'held'in entry:continue
  path=root/entry['source'];assert sha(path)==entry['sha256'];duration=entry['duration'];assert duration and duration>0
  fbx_world=None
  if entry.get('kind')=='fbx':
   old_objects=set(bpy.data.objects);old_actions=set(bpy.data.actions);bpy.ops.import_scene.fbx(filepath=str(path));imported=set(bpy.data.objects)-old_objects
   src=next(o for o in imported if o.type=='ARMATURE');fps=sc.render.fps/sc.render.fps_base;src_actions=set(bpy.data.actions)-old_actions
   ac=next(x for x in src_actions if x.name.split('|')[-1]==entry['take']);use_action(src,ac);start=float(ac.frame_range[0])
   shared=[n for n in names if n in src.data.bones];sr={n:np.array(src.data.bones[n].matrix_local) for n in shared};trg={n:np.array(rest[n]) for n in shared}
   fiterr,ax,ss,tt=fit(np.array([sr[n][:3,3] for n in shared]),np.array([trg[n][:3,3] for n in shared]));assert fiterr<0.01,('FBX rig fit metres',path,fiterr)
   fbx_world=[]
   for frame in range(round(duration*120)+1):
    at=start+min(frame/120,duration)*fps;sc.frame_set(int(at),subframe=at%1);bpy.context.view_layer.update();world={n:np.array(rest[n]) for n in names}
    for n in shared:
     pose=np.array(src.pose.bones[n].matrix);m=np.eye(4);m[:3,:3]=ax@polar(pose[:3,:3])@polar(sr[n][:3,:3]).T@ax.T@polar(trg[n][:3,:3]);m[:3,3]=ss*(ax@pose[:3,3])+tt;world[n]=m
    fbx_world.append(world)
   for obj in imported:bpy.data.objects.remove(obj,do_unlink=True)
   for ac in src_actions:bpy.data.actions.remove(ac)
   sc.render.fps=120
  else:
   curve_guards[clip]=guard_curves(path.read_text(), ref_path.read_text());curves=parse(path)
  act=bpy.data.actions.new(clip);act.use_fake_user=True;use_action(arm,act)
  for frame in range(round(duration*120)+1):
   t=min(frame/120,duration);world=fbx_world[frame] if fbx_world is not None else convert(fk(curves,t))
   for bone in bones:
    n=bone.name;local=Matrix(world[n]);parent=parents[n]
    if parent: basis=(rest[parent].inverted()@rest[n]).inverted()@Matrix(world[parent]).inverted()@local
    else:basis=rest[n].inverted()@local
    pb=arm.pose.bones[n];pb.rotation_mode='QUATERNION';pb.matrix_basis=basis
    pb.keyframe_insert(data_path='location',frame=frame,group=n);pb.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=n);pb.keyframe_insert(data_path='scale',frame=frame,group=n)
  for layer in act.layers:
   for strip in layer.strips:
    for bag in strip.channelbags:
     for curve in bag.fcurves:
      for key in curve.keyframe_points:key.interpolation='LINEAR'
  rows.append({'name':clip,'source':entry['source'],'sha256':entry['sha256'],'duration':duration,'controllerSpeed':entry['speed'],'contact':entry['contact']})
 # Compare evaluated posed vertices before/after the mandatory two-bone clamp, including contact and KO end.
 def skin_world():
  result=[];deps=bpy.context.evaluated_depsgraph_get()
  for obj in bpy.data.objects:
   if obj.type!='MESH' or not obj.vertex_groups:continue
   ev=obj.evaluated_get(deps);mesh=ev.to_mesh();arr=np.empty(len(mesh.vertices)*3);mesh.vertices.foreach_get('co',arr);arr=arr.reshape(-1,3);m=np.array(obj.matrix_world);result.append(arr@m[:3,:3].T+m[:3,3]);ev.to_mesh_clear()
  return np.concatenate(result)
 audit_samples=[];before_skin=[]
 for row in rows:
  ac=bpy.data.actions[row['name']];use_action(arm,ac)
  for t in sorted(set([0,row['duration']*.25,row['duration']*.5,row['duration']*.75,row['duration'],row['contact'] or 0])):
   frame=t*120;sc.frame_set(int(frame),subframe=frame%1);bpy.context.view_layer.update();audit_samples.append((row['name'],t));before_skin.append(skin_world())
 changed=0;max_before=0
 for obj in bpy.data.objects:
  if obj.type!='MESH':continue
  valid={g.index for g in obj.vertex_groups if g.name in names}
  for v in obj.data.vertices:
   weights=sorted([(g.group,g.weight) for g in v.groups if g.group in valid and g.weight>0],key=lambda x:-x[1]);max_before=max(max_before,len(weights))
   if len(weights)<=2:continue
   changed+=1;total=sum(w for _,w in weights[:2])
   for idx,_ in weights:obj.vertex_groups[idx].remove([v.index])
   for idx,w in weights[:2]:obj.vertex_groups[idx].add([v.index],w/total,'REPLACE')
 deformation=[]
 for (name,t),before in zip(audit_samples,before_skin):
  use_action(arm,bpy.data.actions[name]);frame=t*120;sc.frame_set(int(frame),subframe=frame%1);bpy.context.view_layer.update();delta=np.linalg.norm(skin_world()-before,axis=1)*1000;deformation.append({'clip':name,'seconds':t,'maxMm':float(delta.max()),'p99Mm':float(np.quantile(delta,.99)),'meanMm':float(delta.mean())})
 arm.animation_data.action=None;sc.frame_start=0;sc.frame_end=max(round(x['duration']*120) for x in rows)
 # Set identity pose before export; skins use rest matrices, not the last clip's defeated pose.
 for b in arm.pose.bones:b.matrix_basis=Matrix.Identity(4)
 out=pathlib.Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,export_frame_step=1,export_force_sampling=True,export_def_bones=True,export_all_influences=False,export_optimize_animation_size=True,export_materials='EXPORT')
 report={'bot':a.bot,'inputSha256':sha(a.input),'outputSha256':sha(out),'referenceFitMm':err*1000*world_units,'armatureWorldScale':world_units,'curveGuards':curve_guards,'heldOutChecks':checks,'axis':axis.tolist(),'scale':scale,'translation':tr.tolist(),'maxWeightsBefore':max_before,'verticesClamped':changed,'maxWeightsAfter':2,'clampDeformation':deformation,'clips':rows}
 out.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n');print('FIGHT_EXPORT',json.dumps(report))
if __name__=='__main__':main()
