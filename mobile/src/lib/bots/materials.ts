import * as THREE from 'three';

export type BotMaterialQuality = 'balanced' | 'pbr';

/** The promo base-color textures retain their authored look with inexpensive diffuse lighting.
 * Full PBR remains selectable for device comparisons; source GLBs are never modified here.
 */
export function prepareBotMaterials(root: THREE.Object3D, quality: BotMaterialQuality): void {
  if (quality === 'pbr') return;
  const replacements = new Map<THREE.Material, THREE.Material>();
  const replace = (material: THREE.Material): THREE.Material => {
    if (!(material instanceof THREE.MeshStandardMaterial)) return material;
    const existing = replacements.get(material);
    if (existing) return existing;
    const result = new THREE.MeshLambertMaterial({
      name: `${material.name}:mobile-diffuse`, color: material.color, map: material.map,
      emissive: material.emissive, emissiveMap: material.emissiveMap,
      emissiveIntensity: material.emissiveIntensity,
      transparent: material.transparent, opacity: material.opacity, alphaTest: material.alphaTest,
      side: material.side, vertexColors: material.vertexColors, depthWrite: material.depthWrite,
    });
    replacements.set(material, result);
    return result;
  };
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
  });
  // This runs before the first draw, so discarded normal/ORM maps were never uploaded to GL.
  replacements.forEach((_, material) => material.dispose());
}
