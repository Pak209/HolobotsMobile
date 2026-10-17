import { describe, expect, it } from 'vitest';
import manifest from '../../../assets/bots/manifest.json';
import { BOT_ATTACK_TAKES, BOT_COMMAND_TAKES, resolveClipName } from '../bots/animationClips';

describe('Unity take aliases against the bundled fleet', () => {
  for (const [id, bot] of Object.entries(manifest.bots)) {
    it(`${id} selects its authored basic and signature takes regardless of manifest order`, () => {
      const clips = bot.clips.map(clip => clip.name).reverse();
      const [basic, signature] = BOT_ATTACK_TAKES[id as keyof typeof BOT_ATTACK_TAKES];
      expect(resolveClipName('AttackBasic', clips, bot.idleClip, id)).toBe(basic);
      expect(resolveClipName('AttackSignature', clips, bot.idleClip, id)).toBe(signature);
      const commands = ['Strike', 'Heavy', 'Finisher'].map(command => resolveClipName(command, clips, bot.idleClip, id));
      expect(commands).toEqual(BOT_COMMAND_TAKES[id as keyof typeof BOT_COMMAND_TAKES]);
      expect(new Set(commands).size).toBe(3);
      expect(commands.every(clip => clip !== null && clips.includes(clip))).toBe(true);
      expect(resolveClipName('AttackHeavy', clips, bot.idleClip, id)).toBe(commands[1]);
      expect(resolveClipName('Idle', clips, bot.idleClip, id)).toBe(bot.idleClip);
      for (const clip of clips) expect(resolveClipName(`HB_${id.toUpperCase()}_Mixar_${clip}`, clips, bot.idleClip, id)).toBe(clip);
    });
  }
  it('keeps ACE signature order separate from its legacy boxing basic and WOLF Mixar replacement order', () => {
    const ace = manifest.bots.ace.clips.map(clip => clip.name);
    const wolf = manifest.bots.wolf.clips.map(clip => clip.name);
    expect(['Strike', 'Heavy', 'Finisher'].map(command => resolveClipName(command, ace, 'FableHover', 'ACE'))).toEqual(['Skybreaker', 'CometCross', 'MeteorHammer']);
    expect(resolveClipName('AttackBasic', ace, 'FableHover', 'ace')).toBe('JabCross');
    expect(resolveClipName('AttackSignature', ace, 'FableHover', 'ace')).toBe('Skybreaker');
    expect(['Strike', 'Heavy', 'Finisher'].map(command => resolveClipName(command, wolf, 'HoverIdle', 'wolf'))).toEqual(['StepCross', 'LowRoundhouse', 'SupermanPunch']);
  });
  it('does not substitute an arbitrary clip when the bot or authored take is absent', () => {
    expect(resolveClipName('AttackBasic', ['Evade', 'Idle', 'Surprise'], 'Idle', 'unknown')).toBeNull();
    expect(resolveClipName('AttackSignature', ['Evade', 'Idle', 'Surprise'], 'Idle', 'wolf')).toBeNull();
    expect(resolveClipName('HitLight', ['Evade', 'Idle', 'Surprise'], 'Idle', 'wolf')).toBeNull();
    for (const command of ['Strike', 'Heavy', 'Finisher']) {
      expect(resolveClipName(command, ['Evade', 'Idle', 'Surprise'], 'Idle', 'wolf')).toBeNull();
      expect(resolveClipName(command, ['StepCross', 'LowRoundhouse', 'SupermanPunch'], 'Idle', 'unknown')).toBeNull();
    }
  });
});
