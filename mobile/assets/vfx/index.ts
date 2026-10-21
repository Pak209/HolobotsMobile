// lite-vfx-port-1: the HoloCity combat-VFX element pack, exported by HolobotsUnity Tools/VFX/pack/export_pack.py
// (--bots ACE,WOLF). Regenerate there; do not edit pack_manifest.json or the PNGs by hand. Metro needs static requires.
import manifest from './pack_manifest.json';
export const VFX_TEXTURE_ASSETS = {
  FlashCore: require('./masks/FlashCore.png') as number,
  SoftGauss32: require('./masks/SoftGauss32.png') as number,
  SoftGauss35: require('./masks/SoftGauss35.png') as number,
  SoftDust: require('./masks/SoftDust.png') as number,
  Mote: require('./masks/Mote.png') as number,
  Residue_ring: require('./masks/Residue_ring.png') as number,
  White: require('./masks/White.png') as number,
  Column: require('./masks/Column.png') as number,
  Residue_scratch3: require('./masks/Residue_scratch3.png') as number,
  RingCore: require('./elements/RingCore.png') as number,
  RingHalo: require('./elements/RingHalo.png') as number,
  GuardHexRing: require('./elements/GuardHexRing.png') as number,
  GuardHexFill: require('./elements/GuardHexFill.png') as number,
} as const;
export type VfxTextureName = keyof typeof VFX_TEXTURE_ASSETS;
export const VFX_PACK = manifest;
