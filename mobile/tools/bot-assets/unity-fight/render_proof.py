"""Headless Blender pose proof from the *decoded packed* asset; no animation authoring.
Workbench view is a rig/skin witness, not a claim of native lighting parity.
"""
import argparse,json,pathlib,sys,math
import bpy
from mathutils import Vector

def action(arm,ac):
 arm.animation_data_create();arm.animation_data.action=ac
 if ac.slots:arm.animation_data.action_slot=next((s for s in ac.slots if s.target_id_type=='OBJECT'),ac.slots[0])
def bounds(objects):
 pts=[];deps=bpy.context.evaluated_depsgraph_get()
 for obj in objects:
  if obj.type!='MESH':continue
  ev=obj.evaluated_get(deps)
  pts.extend(ev.matrix_world@Vector(p) for p in ev.bound_box)
 lo=Vector(tuple(min(p[i] for p in pts)for i in range(3)));hi=Vector(tuple(max(p[i] for p in pts)for i in range(3)));return lo,hi

def main():
 p=argparse.ArgumentParser();p.add_argument('--bot',required=True);p.add_argument('--packed',required=True);p.add_argument('--original',required=True);p.add_argument('--report',required=True);p.add_argument('--output',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True);report=json.load(open(a.report))
 bpy.ops.wm.read_factory_settings(use_empty=True);sc=bpy.context.scene;sc.render.engine='BLENDER_WORKBENCH';sc.render.resolution_x=720;sc.render.resolution_y=880;sc.render.resolution_percentage=100;sc.render.image_settings.file_format='PNG';sc.render.film_transparent=False;sc.display.shading.light='STUDIO';sc.display.shading.color_type='TEXTURE';sc.display.shading.show_shadows=True;sc.display.shading.show_cavity=True;sc.display.shading.cavity_type='BOTH';sc.display.shading.background_type='WORLD';sc.world=bpy.data.worlds.new('ProofWorld');sc.world.color=(.012,.025,.05);sc.view_settings.view_transform='Standard'
 bpy.ops.import_scene.gltf(filepath=a.packed);after=list(bpy.context.scene.objects);arm=next(o for o in after if o.type=='ARMATURE');acts={x.name:x for x in bpy.data.actions};fps=sc.render.fps/sc.render.fps_base
 for o in after:
  if o.animation_data:
   for t in list(o.animation_data.nla_tracks):o.animation_data.nla_tracks.remove(t)
 action(arm,acts['FightIdle']);sc.frame_set(0);bpy.context.view_layer.update();lo,hi=bounds(after);center=(lo+hi)*.5;height=hi.z-lo.z
 camdata=bpy.data.cameras.new('ProofCamera');cam=bpy.data.objects.new('ProofCamera',camdata);sc.collection.objects.link(cam);sc.camera=cam;camdata.type='ORTHO';camdata.ortho_scale=height*1.35;cam.location=center+Vector((height*1.8,-height*3,height*.7));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();camdata.lens=50
 worst=max(report['clampDeformation'],key=lambda r:r['maxMm']);samples=[]
 for name in ['FightLight','FightHeavy','FightSpecial','FightKO']:
  row=next(r for r in report['clips']if r['name']==name);samples.append((name,row['contact'] if row['contact']is not None else row['duration']))
 samples.append((worst['clip'],worst['seconds']))
 index=[]
 for i,(name,time)in enumerate(samples):
  action(arm,acts[name]);at=time*fps;sc.frame_set(int(at),subframe=at%1);bpy.context.view_layer.update();lo,hi=bounds(after)
  # One common game-framing camera; widen only when a real aerial/KO silhouette needs it, and record the factor.
  factor=max(1,(hi.z-lo.z)/(height*1.05),(hi.x-lo.x)/(height*.75));camdata.ortho_scale=height*1.35*factor
  target=(lo+hi)*.5;cam.location=target+Vector((height*1.8,-height*3,height*.7));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
  path=out/f'{i:02d}-{name}.png';sc.render.filepath=str(path);bpy.ops.render.render(write_still=True);index.append(dict(file=path.name,clip=name,seconds=time,kind='decoded-packed',cameraWiden=factor))
 # Same worst-pose action on the untouched original four-weight mesh makes the skin clamp visible.
 old=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=a.original);before=[o for o in bpy.data.objects if o not in old];beforearm=next(o for o in before if o.type=='ARMATURE')
 for o in before:
  if o.animation_data:
   for t in list(o.animation_data.nla_tracks):o.animation_data.nla_tracks.remove(t)
 for o in after:o.hide_render=True
 action(beforearm,acts[worst['clip']]);at=worst['seconds']*fps;sc.frame_set(int(at),subframe=at%1);bpy.context.view_layer.update()
 path=out/'05-original-weights-same-pose.png';sc.render.filepath=str(path);bpy.ops.render.render(write_still=True);index.append(dict(file=path.name,clip=worst['clip'],seconds=worst['seconds'],kind='original-weights/new-pose',clampMaxMm=worst['maxMm']))
 (out/'frames.json').write_text(json.dumps({'bot':a.bot,'renderer':'Blender Workbench texture studio; no native lighting claim','frames':index},indent=2)+'\n')
if __name__=='__main__':main()
