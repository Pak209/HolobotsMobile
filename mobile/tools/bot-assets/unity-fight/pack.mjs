import {compactAccessorDefaults} from './compact_defaults.mjs';
/** Compress the Blender roundtrip without a second geometry simplification. Fail closed on every structural/budget gate. */
import {createRequire} from 'node:module';import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const require=createRequire(process.env.BOT_TOOLS_PACKAGE ?? new URL('../package.json',import.meta.url));
const{NodeIO}=require('@gltf-transform/core');const{ALL_EXTENSIONS}=require('@gltf-transform/extensions');const{dedup,resample,prune,meshopt,textureCompress}=require('@gltf-transform/functions');const{MeshoptEncoder,MeshoptDecoder}=require('meshoptimizer');const sharp=require('sharp');const validator=require('gltf-validator');
const [input,output,original]=process.argv.slice(2);if(!input||!output||!original)throw Error('pack.mjs input output original');await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});const d=await io.read(input),before=await io.read(original);
const beforeNames=before.getRoot().listAnimations().map(a=>a.getName());const names=d.getRoot().listAnimations().map(a=>a.getName());for(const name of beforeNames)assert(names.includes(name),'lost original take '+name);
for(const name of ['FightLight','FightHeavy','FightSpecial','FightHitLight','FightHitHeavy','FightGuard','FightKO','FightIdle','FightRun'])assert(names.includes(name),'missing fight take '+name);
// Reuse the already-compressed texture payload when Blender preserved its named image. Never change texture resolution.
const oldTextures=new Map(before.getRoot().listTextures().map(t=>[t.getName(),t]));let restored=0;
for(const t of d.getRoot().listTextures()){const old=oldTextures.get(t.getName());if(old){t.setImage(old.getImage()).setMimeType(old.getMimeType());restored++}}
// A constant channel equal to the node's rest value has no effect. Removing it is lossless,
// and avoids paying for 120 Hz copies of unit scale on every bone in every take.
let constantRestChannelsRemoved=0;
for(const animation of d.getRoot().listAnimations()) for(const channel of [...animation.listChannels()]) {
 const sampler=channel.getSampler(),node=channel.getTargetNode(),property=channel.getTargetPath();
 const rest=property==='translation'?node.getTranslation():property==='rotation'?node.getRotation():property==='scale'?node.getScale():null;
 if(!rest)continue;const values=sampler.getOutput().getArray(),f32=new Float32Array(rest);
 if(Array.from(values).every((value,i)=>value===f32[i%f32.length])) {channel.dispose();constantRestChannelsRemoved++;}
}
await d.transform(dedup(),resample({tolerance:0.0000001}),dedup(),prune());
assert.equal(restored,d.getRoot().listTextures().length,'texture payload not restored; no implicit compression fallback');
let maxWeights=0,vertices=0,triangles=0;
for(const mesh of d.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
 const weights=p.getAttribute('WEIGHTS_0');if(weights){const a=weights.getArray();for(let i=0;i<a.length;i+=4){const n=Array.from(a.slice(i,i+4)).filter(w=>w>1e-6).length;maxWeights=Math.max(maxWeights,n);vertices++;assert(n<=2,'skin exceeds two influences');assert(Math.abs(a[i]+a[i+1]+a[i+2]+a[i+3]-1)<0.002,'skin not normalized')}}
 assert(!p.getAttribute('WEIGHTS_1'),'extra weight set');triangles+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;
}
await d.transform(meshopt({encoder:MeshoptEncoder,level:'medium'}));await fs.mkdir(path.dirname(output),{recursive:true});await io.write(output,d);const compact=compactAccessorDefaults(await fs.readFile(output));await fs.writeFile(output,compact.bytes);const bytes=compact.bytes;assert(bytes.length<=2_000_000,`${bytes.length} exceeds 2MB/bot`);const v=await validator.validateBytes(new Uint8Array(bytes),{uri:path.basename(output),maxIssues:100});assert.equal(v.issues.numErrors,0,JSON.stringify(v.issues));
const clips=d.getRoot().listAnimations().map(a=>({name:a.getName(),seconds:Math.max(...a.listSamplers().map(s=>Math.max(...s.getInput().getArray()))),channels:a.listChannels().length}));const report={accessorDefaultsRemoved:compact.removed,jsonBytesSaved:compact.savedBytes,constantRestChannelsRemoved,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),maxWeights,vertices,triangles,texturesRestored:restored,clips,errors:v.issues.numErrors,warnings:v.issues.numWarnings};await fs.writeFile(output+'.report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
