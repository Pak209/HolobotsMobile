import { AnimationClip, Quaternion, Vector3 } from 'three';

const LOCOMOTION = new Set(['Idle', 'Walk', 'Run']);
const QUARTER_TURN_X = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/** Port of FleetMixarImportTool.RepairHareLocomotionAxes, limited to the three affected takes.
 * In the bundled glTF these Hips keys have x ≈ -0.6/-0.7; the +90° X premultiply
 * makes the head-to-hips vector upright, matching the already-correct attack takes.
 * The x guard skips a future corrected export and prevents applying the repair twice.
 */
export function repairHareLocomotion(botId: string, clips: readonly AnimationClip[]): AnimationClip[] {
  return clips.map(clip => {
    if (botId.toLowerCase() !== 'hare' || !LOCOMOTION.has(clip.name)) return clip;
    const source = clip.tracks.find(track => track.name === 'Hips.quaternion');
    if (!source || source.getValueSize() !== 4 || Math.abs(source.values[0]) < 0.5) return clip;
    const repaired = clip.clone();
    const hips = repaired.tracks.find(track => track.name === source.name)!;
    const value = new Quaternion();
    for (let offset = 0; offset < hips.values.length; offset += 4) {
      value.fromArray(hips.values, offset).premultiply(QUARTER_TURN_X).normalize().toArray(hips.values, offset);
    }
    return repaired;
  });
}
