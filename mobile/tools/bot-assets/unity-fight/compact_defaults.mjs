import assert from 'node:assert/strict';
/** glTF accessor.normalized defaults to false. Omit redundant defaults for accessors, buffer views and animation samplers.
 * The BIN chunk and every numeric sample remain byte-identical: no resampling or re-quantization. */
export function compactAccessorDefaults(input) {
  const bytes=Buffer.from(input);
  assert.equal(bytes.readUInt32LE(0),0x46546c67); assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length); assert.equal(bytes.readUInt32LE(16),0x4e4f534a);
  const jsonLength=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+jsonLength).toString('utf8'));
  let removed=0;
  for(const accessor of doc.accessors??[]) {
    if(accessor.normalized===false){delete accessor.normalized;removed++;}
    if(accessor.byteOffset===0){delete accessor.byteOffset;removed++;}
  }
  for(const view of doc.bufferViews??[]) if(view.byteOffset===0){delete view.byteOffset;removed++;}
  for(const animation of doc.animations??[]) for(const sampler of animation.samplers??[])
    if(sampler.interpolation==='LINEAR'){delete sampler.interpolation;removed++;}
  const json=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded);
  const tail=bytes.subarray(20+jsonLength),out=Buffer.alloc(20+padded.length+tail.length);
  bytes.subarray(0,12).copy(out);out.writeUInt32LE(out.length,8);out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4e4f534a,16);
  padded.copy(out,20);tail.copy(out,20+padded.length);
  assert(out.subarray(20+padded.length).equals(tail),'binary payload changed');
  return {bytes:out,removed,savedBytes:bytes.length-out.length};
}
