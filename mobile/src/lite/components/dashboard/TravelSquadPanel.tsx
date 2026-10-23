import { theme } from "@/lite/theme";
import { useCompactText } from "@/lite/components/FigmaCanvas";
import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { HolobotRosterEntry } from '@/config/holobots';
import { GameDialogFrame, GameSurfaceFrame } from '@/lite/components/ui/GameSurfaceFrame';
import { TravelSquadSession, type SquadState } from '@/lib/travelSquadClient';
import { publishTravelSquadSnapshot, subscribeTravelSquadSnapshots, travelSquadInvoker } from '@/lib/travelSquadFirebase';
import { presentSquadTitle } from '@/lite/lib/hostDashboard';

/** Dashboard entry and owned-roster picker. Membership appears only after host confirmation.
 * `levels` (holobot id -> LV) comes from the desktopAccountSnapshot read; null = that read is unavailable. */
export function TravelSquadPanel({ uid, roster, inline = false, levels }: { uid?: string; roster: HolobotRosterEntry[]; inline?: boolean; levels?: Readonly<Record<string, number>> | null }) {
  const fit = useCompactText();
  const [open, setOpen] = useState(false), [slot, setSlot] = useState(0);
  const [state, setState] = useState<SquadState>({ squad: null, busy: false, retry: false, message: '' });
  const session = useRef<TravelSquadSession | null>(null);
  useEffect(() => {
    setOpen(false); setSlot(0); setState({ squad: null, busy: false, retry: false, message: '' });
    if (!uid) return;
    const model = new TravelSquadSession(travelSquadInvoker(uid), setState, snapshot => publishTravelSquadSnapshot(uid, snapshot));
    session.current = model;
    const off = subscribeTravelSquadSnapshots(update => { if (update.uid === uid) model.accept(update.snapshot); });
    void model.refresh();
    return () => { off(); model.dispose(); session.current = null; };
  }, [uid]);
  const ids = state.squad?.holobotIds ?? [];
  const owned = roster.filter(bot => bot.owned);
  const title = levels === undefined
    ? (state.squad ? (ids.length ? ids.map(id => id.toUpperCase()).join(' · ') : 'NO HOLOBOTS ASSIGNED') : 'CONNECT TO VIEW SQUAD')
    : presentSquadTitle(state.squad ? ids : null, levels);
  return <>
    <Pressable style={inline ? styles.inlineEntry : styles.entry} accessibilityRole="button" accessibilityLabel={`Manage travel squad. ${title}`} onPress={() => { setOpen(true); void session.current?.refresh(); }}>
      <GameSurfaceFrame accent={theme.colors.accent} fill={theme.plates.navy} />
      <Text style={[styles.entryTitle, fit(styles.entryTitle)]} numberOfLines={1}>TRAVEL SQUAD</Text><Text style={[styles.entryNames, fit(styles.entryNames)]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{title}</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}><View style={styles.sheet}>
        <GameDialogFrame accent={theme.colors.accent} fill={theme.plates.navy} />
        <Text style={styles.heading}>TRAVEL SQUAD</Text>
        <Text style={styles.help}>Choose a slot, then an owned Holobot. Changes are confirmed by the server.</Text>
        <View style={styles.slots}>{[0, 1, 2].map(index => <Pressable key={index} accessibilityRole="button" accessibilityState={{ selected: slot === index, disabled: state.busy || state.retry || !state.squad || index > ids.length }}
          disabled={state.busy || state.retry || !state.squad || index > ids.length} onPress={() => setSlot(index)} style={styles.slot}>
          <GameSurfaceFrame accent={slot === index ? theme.colors.accent : theme.colors.border} fill={theme.plates.navy} strong={slot === index} />
          <Text style={styles.slotNumber}>SLOT {index + 1}</Text>{state.squad ? <Text style={styles.slotName}>{ids[index]?.toUpperCase() ?? 'EMPTY'}</Text> : null}
        </Pressable>)}</View>
        <Text style={styles.status} accessibilityLiveRegion="polite">{state.message || (state.busy ? 'Loading travel squad…' : 'Choose your companions.')}</Text>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {owned.map(bot => {
            const id = bot.name.toLowerCase(); const elsewhere = ids.includes(id) && ids[slot] !== id;
            const disabled = !state.squad || state.busy || state.retry || elsewhere || slot > ids.length;
            return <Pressable key={bot.key} disabled={disabled} onPress={() => void session.current?.choose(slot, id)} style={[styles.row, disabled && styles.dim]} accessibilityRole="button" accessibilityLabel={`Assign ${bot.name} to slot ${slot + 1}`} accessibilityState={{ disabled }}>
              <GameSurfaceFrame accent={ids[slot] === id ? theme.colors.success : theme.colors.border} fill={theme.plates.navy} />
              <Image source={bot.imageSource} style={styles.portrait} resizeMode="contain" />
              <View style={styles.description}><Text style={styles.name}>{bot.name}</Text><Text style={styles.help}>{elsewhere ? 'IN ANOTHER SLOT' : ids[slot] === id ? 'IN THIS SLOT' : `CHOOSE FOR SLOT ${slot + 1}`}</Text></View>
            </Pressable>;
          })}
          {!owned.length && <Text style={styles.help}>No owned Holobots in your roster yet.</Text>}
        </ScrollView>
        <View style={styles.actions}>
          <Pressable style={styles.action} disabled={state.busy || !uid} onPress={() => void (state.retry ? session.current?.retry() : session.current?.refresh())} accessibilityRole="button"><GameSurfaceFrame accent={theme.colors.accent} /><Text style={styles.actionText}>{state.busy ? 'WAITING…' : state.retry ? 'RETRY CHANGE' : 'REFRESH'}</Text></Pressable>
          <Pressable style={styles.action} onPress={() => setOpen(false)} accessibilityRole="button"><GameSurfaceFrame accent={theme.colors.accent} /><Text style={styles.actionText}>BACK</Text></Pressable>
        </View>
      </View></View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  inlineEntry: { minHeight: 64, padding: 14, alignItems: "center", justifyContent: "center" },
  entry: { position: 'absolute', left: '47%', top: '62.8%', width: '46%', height: '5.2%', zIndex: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  entryTitle: { color: theme.colors.accent, fontFamily: "HoloBody", fontSize: 11, fontWeight: '800' }, entryNames: { color: theme.colors.text, fontFamily: "HoloBody", fontSize: theme.type.micro.fontSize, marginTop: 3 },
  backdrop: { flex: 1, backgroundColor: '#000b', padding: 20, alignItems: 'center', justifyContent: 'center' },
  sheet: { width: '100%', maxWidth: 620, maxHeight: '92%', padding: 24, gap: 12 },
  heading: { color: theme.colors.accent, fontFamily: "HoloDisplay", fontSize: 24, fontWeight: '900' }, help: { color: theme.colors.muted, fontFamily: "HoloBody", fontSize: 13, lineHeight: 19 },
  slots: { flexDirection: 'row', gap: 8 }, slot: { flex: 1, minHeight: 64, padding: 10, justifyContent: 'center' },
  slotNumber: { color: theme.colors.subtle, fontSize: 11 }, slotName: { color: theme.colors.text, fontFamily: "HoloBody", fontSize: 13, fontWeight: '800', marginTop: 4 },
  status: { color: '#f0cf70', fontFamily: "HoloBody", fontSize: 13, lineHeight: 19, minHeight: 38 }, list: { flexShrink: 1 }, listContent: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, minHeight: 88 }, dim: { opacity: 0.5 },
  portrait: { width: 58, height: 62 }, description: { flex: 1, paddingLeft: 12 }, name: { color: theme.colors.text, fontFamily: "HoloDisplay", fontSize: 18, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10 }, action: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center' }, actionText: { color: theme.colors.text, fontFamily: "HoloBody", fontSize: 13, fontWeight: '800' },
});
