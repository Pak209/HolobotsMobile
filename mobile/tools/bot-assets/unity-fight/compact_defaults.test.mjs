import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactAccessorDefaults } from './compact_defaults.mjs';
function glb(doc,bin=Buffer.from([0,1,255,16])) {
  const json=Buffer.from(JSON.stringify(doc));const size=Math.ceil(json.length/4)*4;
  const out=Buffer.alloc(28+size+bin.length,0x20);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(size,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);
  out.writeUInt32LE(bin.length,20+size);out.writeUInt32LE(0x004e4942,24+size);bin.copy(out,28+size);return out;
}
const doc=b=>JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
const tail=b=>b.subarray(20+b.readUInt32LE(12));
test('removes only equivalent defaults and preserves every BIN byte and non-default',()=>{
 const input=glb({asset:{version:'2.0'},accessors:[{normalized:false,byteOffset:0},{normalized:true,byteOffset:8}],
  bufferViews:[{byteOffset:0},{byteOffset:12}],animations:[{samplers:[{interpolation:'LINEAR'},{interpolation:'STEP'},{interpolation:'CUBICSPLINE'}]}]});
 const result=compactAccessorDefaults(input);
 assert.equal(result.removed,4);assert(result.savedBytes>0);assert(tail(input).equals(tail(result.bytes)));
 assert.deepEqual(doc(result.bytes).accessors,[{},{normalized:true,byteOffset:8}]);
 assert.deepEqual(doc(result.bytes).animations[0].samplers,[{},{interpolation:'STEP'},{interpolation:'CUBICSPLINE'}]);
 assert.deepEqual(compactAccessorDefaults(result.bytes).bytes,result.bytes);
});
test('refuses a malformed GLB length rather than rewriting it',()=>{
 const input=glb({asset:{version:'2.0'}});input.writeUInt32LE(input.length+4,8);
 assert.throws(()=>compactAccessorDefaults(input));
});
