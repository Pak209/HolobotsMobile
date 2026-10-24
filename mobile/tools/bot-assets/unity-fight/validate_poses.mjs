/** Independent decoded-GLB contact/end pose audit, including every joint and original take. */
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const tools=createRequire(process.env.BOT_TOOLS_PACKAGE ?? new URL('../package.json',import.meta.url));
const app=createRequire(new URL('../../../package.json',import.meta.url));
const {NodeIO}=tools('@gltf-transform/core');const {ALL_EXTENSIONS}=tools('@gltf-transform/extensions');const {MeshoptDecoder}=tools('meshoptimizer');
const {Matrix4,Quaternion,Vector3}=app('three');
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const [rawPath,packedPath,sourceReport,output]=process.argv.slice(2);
const raw=await io.read(rawPath),packed=await io.read(packedPath),report=JSON.parse(await fs.readFile(sourceReport,'utf8'));
function values(sampler,time,path) {
 const times=sampler.getInput().getArray(),data=sampler.getOutput().getArray(),size=sampler.getOutput().getElementSize();
 assert(['LINEAR','STEP'].includes(sampler.getInterpolation()),'unsupported interpolation');
 let i=0;while(i+1<times.length&&times[i+1]<=time)i++;
 const a=Array.from(data.slice(i*size,(i+1)*size));if(i===times.length-1||time<=times[0]||sampler.getInterpolation()==='STEP')return a;
 const b=Array.from(data.slice((i+1)*size,(i+2)*size)),u=(time-times[i])/(times[i+1]-times[i]);
 return path==='rotation'?new Quaternion(...a).slerp(new Quaternion(...b),u).toArray():a.map((v,k)=>v+(b[k]-v)*u);
}
function world(document,animation,time) {
 const nodes=document.getRoot().listNodes(),trs=new Map(nodes.map(n=>[n,{translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale()}]));
 for(const channel of animation.listChannels())trs.get(channel.getTargetNode())[channel.getTargetPath()]=values(channel.getSampler(),time,channel.getTargetPath());
 const matrices=new Map();function matrix(n){if(matrices.has(n))return matrices.get(n);const t=trs.get(n),m=new Matrix4().compose(new Vector3(...t.translation),new Quaternion(...t.rotation),new Vector3(...t.scale));if(n.getParentNode())m.premultiply(matrix(n.getParentNode()));matrices.set(n,m);return m;}
 const joints=document.getRoot().listSkins().flatMap(s=>s.listJoints());return new Map(joints.map(n=>[n.getName(),matrix(n)]));
}
const rows=[];
for(const clip of raw.getRoot().listAnimations()){
 const name=clip.getName(),after=packed.getRoot().listAnimations().find(a=>a.getName()===name);assert(after,'lost '+name);
 const times=clip.listSamplers().flatMap(s=>Array.from(s.getInput().getArray())),start=Math.min(...times),end=Math.max(...times),contact=report.clips.find(c=>c.name===name)?.contact;
 for(const time of new Set([start,start+(end-start)*.25,start+(end-start)*.5,start+(end-start)*.75,end,...(contact===null||contact===undefined?[]:[contact])])){
  const a=world(raw,clip,time),b=world(packed,after,time);let positionMm=0,rotationDeg=0;
  for(const [joint,m]of a){assert(b.has(joint),'lost joint '+joint);const p1=new Vector3(),p2=new Vector3(),q1=new Quaternion(),q2=new Quaternion();m.decompose(p1,q1,new Vector3());b.get(joint).decompose(p2,q2,new Vector3());positionMm=Math.max(positionMm,p1.distanceTo(p2)*1000);rotationDeg=Math.max(rotationDeg,q1.angleTo(q2)*180/Math.PI);}
  rows.push({clip:name,seconds:time,joints:a.size,positionMm,rotationDeg});
 }
}
const result={bot:report.bot,rawPath,packedPath,maxPositionMm:Math.max(...rows.map(r=>r.positionMm)),maxRotationDeg:Math.max(...rows.map(r=>r.rotationDeg)),samples:rows};
await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({bot:result.bot,samples:rows.length,maxPositionMm:result.maxPositionMm,maxRotationDeg:result.maxRotationDeg}));

assert(result.maxPositionMm<=1 && result.maxRotationDeg<=.2,'decoded joint error exceeds 1 mm / 0.2 degrees');
