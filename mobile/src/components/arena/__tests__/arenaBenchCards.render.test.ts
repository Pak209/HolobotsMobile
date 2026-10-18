import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { createElement, Fragment } from 'react';
// Host components as plain tags: the real ArenaBenchCards tree is expanded below without a native renderer.
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', StyleSheet: { create: <T>(styles: T) => styles } }));
vi.mock('@/config/holobots', () => ({ getHolobotFullImageSource: (id: string) => ({ uri: `bot://${id}` }) }));
import { ArenaBenchCards } from '../ArenaBenchCards';
import { readArena3v3Reply, type Arena3v3Match } from '@/lib/arenaMatch3v3';
import { ARENA_3V3_FIXTURE_STEPS } from '@/qa/arenaBenchFixtures';

// The component compiles with classic JSX (React.createElement); vitest's esbuild does not inject React for it.
(globalThis as any).React = React;

type HostNode = { type: string; props: Record<string, any>; children: Array<HostNode | string> };
/** Expand function components (these have no hooks) down to host nodes and text. */
function render(el: any): Array<HostNode | string> {
    if (el === null || el === undefined || typeof el === 'boolean') return [];
    if (typeof el === 'string' || typeof el === 'number') return [String(el)];
    if (Array.isArray(el)) return el.flatMap(render);
    if (el.type === Fragment) return render(el.props.children);
    if (typeof el.type === 'function') return render(el.type(el.props));
    return [{ type: el.type, props: el.props, children: render(el.props.children) }];
}
const textOf = (n: HostNode | string): string => typeof n === 'string' ? n : n.children.map(textOf).join('');
const find = (nodes: Array<HostNode | string>, pred: (n: HostNode) => boolean): HostNode[] =>
    nodes.flatMap(n => typeof n === 'string' ? [] : [...(pred(n) ? [n] : []), ...find(n.children, pred)]);
const style = (n: HostNode): Record<string, any> => [n.props.style].flat(Infinity).filter(Boolean).reduce((a, s) => ({ ...a, ...s }), {});
const texts = (nodes: Array<HostNode | string>) => find(nodes, n => n.type === 'Text').map(textOf);

/** A mid-match forfeit (state cancelled, phase send_in): a closed match where only the state gate can hide SWAP IN. */
function forfeit() {
    const r: any = JSON.parse(JSON.stringify(ARENA_3V3_FIXTURE_STEPS.find(s => s.name === 'report-2-active-ko')!.reply)), m = r.match, closed = m.issuedAtMs + 9500;
    Object.assign(m, { state: 'cancelled', closedAtMs: closed, settlementReceipt: { matchId: m.matchId, outcome: 'forfeit', refunded: false, settlement: null, report: null,
        finalVitals: Object.fromEntries(m.team.map((x: any) => [x.fighter.holobotId, x.vitals])), closedAtMs: closed } });
    r.intent = null; return r;
}
const projections = [...ARENA_3V3_FIXTURE_STEPS.filter(s => (s.reply as any)?.match).map(s => ({ name: s.name, match: readArena3v3Reply(s.reply).match! })),
    { name: 'forfeit (closed in send_in)', match: readArena3v3Reply(forfeit()).match! }];
const swappable = (m: Arena3v3Match) => m.state === 'active' && (m.battle.phase === 'command' || m.battle.phase === 'send_in');

describe('ArenaBenchCards renders only host vitals and the host level', () => {
    it.each(projections.map(p => [p.name, p.match] as const))('%s', (_name, match) => {
        const tree = render(createElement(ArenaBenchCards, { match, onSwap: () => { } }));
        const cards = find(tree, n => n.type === 'View' && / HP \d/.test(String(n.props.accessibilityLabel ?? '')));
        expect(cards).toHaveLength(3);
        const order = [match.battle.activeSlot, ...[0, 1, 2].filter(i => i !== match.battle.activeSlot)];
        cards.forEach((card, position) => {
            const slot = match.team[order[position]], { currentHealth, maxHealth } = slot.vitals;
            const cardTexts = texts([card]);
            // HP text and bar width come straight from host vitals.
            expect(cardTexts.filter(t => /\bHP\b/.test(t))).toEqual([`HP ${currentHealth} / ${maxHealth}`]);
            const track = find([card], n => n.type === 'View' && style(n).height === 6 && style(n).flexDirection === 'row');
            expect(track).toHaveLength(1);
            const [fill, rest] = track[0].children as HostNode[];
            expect(style(fill).flex / (style(fill).flex + style(rest).flex)).toBeCloseTo(currentHealth / maxHealth, 12);
            // The level is the host #118 level, on a lower-left corner tab.
            expect(cardTexts.filter(t => /\bLV\b/.test(t))).toEqual([`LV ${slot.fighter.level}`]);
            const tab = find([card], n => n.type === 'View' && style(n).position === 'absolute');
            expect(tab.map(style).map(s => [s.left, s.bottom])).toEqual([[0, 0]]);
            expect(texts(tab)).toEqual([`LV ${slot.fighter.level}`]);
            // Status tag: 1-indexed bench position, never a slot index.
            const tag = slot.status === 'ko' ? 'KO' : slot.status === 'active' ? 'ACTIVE' : `BENCH ${position}`;
            expect(cardTexts).toContain(tag);
            // SWAP IN only on a living bench card of an active match.
            const swaps = find([card], n => n.type === 'Pressable');
            expect(swaps.map(textOf)).toEqual(swappable(match) && slot.status === 'bench' ? ['SWAP IN'] : []);
        });
        // No other LV or HP text anywhere, no STA, and no "host" on screen.
        const all = texts(tree);
        expect(all.filter(t => /\bLV\b/.test(t))).toHaveLength(3);
        expect(all.filter(t => /\bHP\b/.test(t))).toHaveLength(3);
        expect(all.join(' ')).not.toMatch(/\bSTA\b|stamina|regen|host/i);
        // The BUDDY strip comes first, and it is empty.
        const flat = all.join('|');
        expect(flat.indexOf('BUDDY')).toBeGreaterThan(-1);
        expect(flat.indexOf('BUDDY')).toBeLessThan(flat.indexOf(match.team[match.battle.activeSlot].fighter.displayName));
        expect(all).toContain('NO BUDDY UNIT FROM YOUR ACCOUNT YET');
    });
    it('without onSwap, or while asking, no SWAP IN is offered', () => {
        const command = projections.find(p => p.name === 'swap-1-voluntary')!.match;
        expect(find(render(createElement(ArenaBenchCards, { match: command })), n => n.type === 'Pressable')).toEqual([]);
        const busy = find(render(createElement(ArenaBenchCards, { match: command, onSwap: () => { }, busy: true })), n => n.type === 'Pressable');
        expect(busy.map(n => [textOf(n), n.props.disabled])).toEqual([['ASKING THE CITY…', true], ['ASKING THE CITY…', true]]);
    });
    it('a tap asks the host for that bench fighter and changes nothing on screen by itself', () => {
        const command = projections.find(p => p.name === 'swap-1-voluntary')!.match, asked: string[] = [];
        const before = JSON.stringify(render(createElement(ArenaBenchCards, { match: command, onSwap: (id: string) => asked.push(id) })), (k, v) => typeof v === 'function' ? undefined : v);
        const tree = render(createElement(ArenaBenchCards, { match: command, onSwap: (id: string) => asked.push(id) }));
        find(tree, n => n.type === 'Pressable').forEach(p => p.props.onPress());
        expect(asked).toEqual(['ace', 'shadow']);
        expect(JSON.stringify(tree, (k, v) => typeof v === 'function' ? undefined : v)).toBe(before);
    });
});
