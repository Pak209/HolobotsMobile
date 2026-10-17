import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from "react-native-svg";
import type { RootTabs } from "../../App";
import { useAuth } from "@/contexts/AuthContext";
import { getHolobotHeadshotImageSource } from "@/config/holobots";
import { CityWorkshopPanel } from "@/components/city/CityWorkshopPanel";
import { CityRivalBattle } from "@/components/city/CityRivalBattle";
import { CITY_DISTRICTS, CITY_RIVAL_PIN_POINTS, cityActionMessage, cityDistrictAccess, cityMapPoint, cityTimeOfDay, readCityStoryFlags, type ArenaCitizen, type ArenaGathering, type CityDistrict } from "@/lib/cityHub";
import { loadCityHub, meetCityPilots } from "@/lib/cityHubClient";
import type { CityHubFixture } from "@/lib/cityHubFixtures";
import { useCityRivalCooldowns } from "@/hooks/useRivalStatus";
import { theme } from "@/theme";

const MAP_WIDTH = 360;
const MAP_HEIGHT = 380;
const districtSymbols = { plaza: "◎", vendor: "▥", workshop: "✚", arena: "◇", harbor: "≈", port: "◈", zone: "△" };

function DistrictBuildings({ x, y, accent }: { x: number; y: number; accent: string }) {
  return <>
    {[[-23, -16, 10], [12, -25, 14], [24, 8, 8]].map(([dx, dy, h], i) => <Polygon key={i}
      points={`${x+dx},${y+dy} ${x+dx+9},${y+dy-5} ${x+dx+18},${y+dy} ${x+dx+18},${y+dy+h} ${x+dx+9},${y+dy+h+5} ${x+dx},${y+dy+h}`}
      fill={theme.plates.raised} stroke={accent} strokeWidth={0.7} opacity={0.7} />)}
  </>;
}

export function CityHubScreen({ fixture }: { fixture?: CityHubFixture } = {}) {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [gathering, setGathering] = useState<(ArenaGathering & { uid: string; accountSnapshot?: unknown }) | null>(null);
  const [hour, setHour] = useState(new Date().getHours());
  const [mapWidth, setMapWidth] = useState(360);
  const [panel, setPanel] = useState<"rivals" | "workshop" | null>(fixture?.initialPanel ?? null);
  const [fighting, setFighting] = useState<ArenaCitizen | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);
  const sessionUid = useRef(user?.uid);
  sessionUid.current = user?.uid;
  const currentGathering = gathering?.uid === user?.uid ? gathering : null;
  const requestRevision = useRef(0);
  const flags = fixture?.storyFlags ?? currentGathering?.storyFlags ?? readCityStoryFlags(undefined);
  const roster = fixture?.roster ?? currentGathering?.roster ?? [];
  const period = cityTimeOfDay(fixture?.hour ?? hour);
  const scale = mapWidth / MAP_WIDTH;
  const districts = CITY_DISTRICTS.filter((district) => cityDistrictAccess(district.id, flags) !== "hidden");
  const tint = period === "night" ? "#091D2B" : "#18343D";

  useEffect(() => {
    setGathering(null); setMessage(null); setFighting(null);
  }, [user?.uid]);
  const cooldowns = useCityRivalCooldowns(user?.uid, !!fixture);
  useFocusEffect(useCallback(() => {
    let active = true;
    const uid = user?.uid;
    const revision = ++requestRevision.current;
    if (!fixture && uid) {
      void loadCityHub(uid).then((reply) => {
        if (active && sessionUid.current === uid && requestRevision.current === revision) setGathering({ uid, schemaVersion: "arena-gathering-1", ...reply });
      }).catch((error) => { if (active && sessionUid.current === uid && requestRevision.current === revision) setMessage(cityActionMessage(error)); });
    }
    return () => { active = false; };
  }, [user?.uid, fixture]));
  useFocusEffect(useCallback(() => {
    const update = () => setHour(new Date().getHours()); update();
    const timer = setInterval(update, 60_000);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") update(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []));

  async function gather() {
    if (busy.current || fixture) return;
    if (!user) { setMessage("Sign in to meet the city pilots."); return; }
    const uid = user.uid; ++requestRevision.current; busy.current = true; setLoading(true); setMessage(null);
    try {
      const reply = await meetCityPilots(uid);
      if (sessionUid.current === uid) { setGathering(previous => ({ ...reply, uid, accountSnapshot: previous?.uid === uid ? previous.accountSnapshot : undefined })); setPanel("rivals"); }
    } catch (error) { if (sessionUid.current === uid) setMessage(cityActionMessage(error)); }
    finally { busy.current = false; setLoading(false); }
  }
  function openDistrict(district: CityDistrict) {
    if (cityDistrictAccess(district.id, flags) === "locked") {
      setMessage("Meet the citizen pilots at the Port gathering to unlock Arena entry."); setPanel("rivals"); return;
    }
    setMessage(null);
    if (district.destination === "Workshop") { setPanel("workshop"); return; }
    if (district.destination === "Rivals") { setPanel("rivals"); return; }
    if (fixture) { fixture.onNavigate?.(district.destination); setMessage(`${district.name} selected · ${district.activity}`); return; }
    navigation.navigate(district.destination);
  }
  function pickRival(rival: ArenaCitizen) {
    if (!fixture && !user) { setMessage("Sign in to challenge a city pilot."); return; }
    if (cooldowns[rival.citizenId]) { setMessage(`${rival.pilotName} is recovering · ${cooldowns[rival.citizenId]}`); return; }
    setPanel("rivals"); setFighting(rival);
  }
  function browseSupplies() {
    setPanel(null);
    if (fixture) fixture.onNavigate?.("Marketplace"); else navigation.navigate("Marketplace");
  }

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24 }}>
      <View style={styles.header}>
        <View><Text style={styles.kicker}>HOLOCITY / MOBILE LINK</Text><Text style={styles.title}>THE CITY IS YOURS.</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to dashboard" onPress={() => fixture ? fixture.onNavigate?.("Home") : navigation.navigate("Home")} style={styles.home}><Text style={styles.homeText}>⌂</Text></Pressable>
      </View>
      <View style={styles.statusRow}>
        <View style={styles.signal}><View style={styles.signalDot} /><Text style={styles.statusText}>{period === "night" ? "NIGHT CYCLE" : "DAY CYCLE"}</Text></View>
        <Text style={styles.statusText}>{roster.length ? `${roster.length} CITIZEN PILOTS` : "GATHERING AWAITS"}</Text>
      </View>
      <View style={styles.mapFrame} onLayout={(event) => setMapWidth(event.nativeEvent.layout.width)}>
        <Svg width="100%" height={MAP_HEIGHT * scale} viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}>
          <Defs><LinearGradient id="cityWater" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={tint} /><Stop offset="1" stopColor="#06101B" /></LinearGradient></Defs>
          <Rect x={0} y={0} width={360} height={380} fill="url(#cityWater)" />
          {Array.from({ length: 15 }, (_, i) => <Path key={`grid${i}`} d={`M ${i*28} 0 V 380 M 0 ${i*28} H 360`} stroke={theme.colors.accent} opacity={0.045} />)}
          <Path d="M 31 59 L 121 26 L 227 20 L 319 73 L 339 163 L 322 255 L 271 278 L 246 317 L 191 336 L 151 322 L 111 301 L 66 275 L 24 208 Z" fill={period === "night" ? "#10232D" : "#29454A"} stroke={theme.colors.accent} strokeOpacity={0.3} />
          <Path d="M 26 219 L 72 286 L 145 334 L 198 350 L 252 328 M 28 235 L 65 292 L 136 343 M 12 253 L 60 309 L 112 342" stroke={theme.colors.accent} strokeWidth={1} strokeOpacity={0.15} fill="none" />
          <Path d="M 190 57 L 190 151 L 170 210 L 146 307 M 67 160 L 190 151 L 281 210 M 67 160 L 99 223 L 170 210 L 239 253 L 281 210" fill="none" stroke="#385463" strokeWidth={12} strokeLinejoin="round" />
          <Path d="M 190 57 L 190 151 L 170 210 L 146 307 M 67 160 L 190 151 L 281 210 M 67 160 L 99 223 L 170 210 L 239 253 L 281 210" fill="none" stroke={theme.colors.accent} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 5" />
          {districts.map((district) => { const p = cityMapPoint(district.world); return <DistrictBuildings key={district.id} x={p.x} y={p.y} accent={district.id === "arena" ? theme.colors.orange : theme.colors.accent} />; })}
          <Circle cx={190} cy={151} r={40} stroke={theme.colors.accent} strokeOpacity={0.18} fill="none" />
          <Circle cx={190} cy={151} r={32} stroke={theme.colors.accent} strokeOpacity={0.12} fill="none" strokeDasharray="3 4" />
          <SvgText x={19} y={24} fill={theme.colors.muted} fontSize={8} letterSpacing={1}>N ↑</SvgText>
          <SvgText x={24} y={358} fill={theme.colors.accent} opacity={0.45} fontSize={9} letterSpacing={3}>HARBOR WATERS</SvgText>
          <Path d="M 277 354 H 330 M 277 350 V 358 M 330 350 V 358" stroke={theme.colors.muted} strokeWidth={1} />
          <SvgText x={288} y={370} fill={theme.colors.muted} fontSize={7}>DISTRICT LINK</SvgText>
        </Svg>
        {districts.map((district) => {
          const point = cityMapPoint(district.world); const locked = cityDistrictAccess(district.id, flags) === "locked";
          return <Pressable key={district.id} accessibilityRole="button" accessibilityLabel={`${district.name}: ${locked ? "locked, meet pilots to unlock" : district.activity}`} testID={`city-district-${district.id}`} onPress={() => openDistrict(district)} style={[styles.mapDistrict, { left: point.x * scale - 47, top: point.y * scale - 25 }]}>
            <View style={[styles.districtSymbol, locked && styles.lockedSymbol]}><Text style={[styles.symbolText, locked && { color: theme.colors.muted }]}>{locked ? "⌑" : districtSymbols[district.id]}</Text></View>
            <Text style={[styles.districtLabel, locked && { color: theme.colors.muted }]}>{district.name.toUpperCase()}{locked ? " · LOCKED" : ""}</Text>
          </Pressable>;
        })}
        {roster.map((rival, i) => { const p = CITY_RIVAL_PIN_POINTS[i]; return p ? <Pressable key={rival.citizenId} accessibilityRole="button" accessibilityLabel={`${cooldowns[rival.citizenId] ? `Recovering ${cooldowns[rival.citizenId]} · ` : ""}Challenge ${rival.pilotName}, ${rival.holobotId.toUpperCase()}, ${rival.rank}`} testID={`city-rival-pin-${i}`} disabled={!!cooldowns[rival.citizenId]} onPress={() => pickRival(rival)} style={[styles.rivalPin, { left: p.x*scale-22, top: p.y*scale-22 }]}><View style={[styles.rivalDot, { borderColor: rival.ringColor }]}><Text style={[styles.pinInitial, { color: rival.ringColor }]}>{rival.pilotName[0]}</Text></View>{cooldowns[rival.citizenId] ? <Text style={styles.caption}>{cooldowns[rival.citizenId]}</Text> : null}</Pressable> : null; })}
      </View>
      <View style={styles.mapCaption}><Text style={styles.caption}>TAP A DISTRICT TO TRAVEL</Text><Text style={styles.caption}>{fixture ? "OFFLINE PREVIEW" : "HOLOCITY LITE"}</Text></View>
      <View style={styles.gatheringCard}>
        <View style={styles.row}><Text style={styles.cardTitle}>CITIZEN GATHERING</Text><Text style={styles.ringBadge}>{roster.length.toString().padStart(2, "0")}</Text></View>
        <Text style={styles.body}>{roster.length ? "Your rivals are out in the city. Follow their rings to meet a pilot and challenge their Holobot." : "Eight pilots. Twelve Holobots. Meet the citizens at the Port gathering to open your Arena journey."}</Text>
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => roster.length ? setPanel("rivals") : void gather()} style={styles.primary}>
          {loading ? <ActivityIndicator color={theme.colors.carbon} /> : <Text style={styles.primaryText}>{roster.length ? "MEET YOUR RIVALS" : "JOIN THE GATHERING"} →</Text>}
        </Pressable>
      </View>
      {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
      <View style={styles.quickRow}>
        <Pressable accessibilityRole="button" onPress={() => setPanel("workshop")} style={styles.quick}><Text style={styles.quickTitle}>WORKSHOP</Text><Text style={styles.caption}>HEAL / CRAFT</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={browseSupplies} style={styles.quick}><Text style={styles.quickTitle}>VENDOR</Text><Text style={styles.caption}>ITEM CATALOG</Text></Pressable>
      </View>
    </ScrollView>
    <Modal animationType="slide" visible={panel !== null} onRequestClose={() => { if (!fighting) setPanel(null); }}>
      {fighting ? <CityRivalBattle accountSnapshot={currentGathering?.accountSnapshot} uid={user?.uid ?? "offline-city-preview"} rival={fighting} preview={!!fixture} onClose={() => setFighting(null)} /> : <View style={[styles.sheet, { paddingTop: insets.top }]}>
        <View style={styles.sheetHeader}><Text style={styles.cardTitle}>{panel === "workshop" ? "WORKSHOP" : "CITIZEN PILOTS"}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close city panel" onPress={() => setPanel(null)} style={styles.close}><Text style={styles.closeText}>✕</Text></Pressable></View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {panel === "workshop" ? <CityWorkshopPanel key={user?.uid ?? "anonymous"} uid={user?.uid} preview={!!fixture} onBrowse={browseSupplies} /> : <View style={styles.rivalList}>
            <Text style={styles.body}>Every pilot has a signature ring. Pick a rival to challenge; the host confirms availability and rewards.</Text>
            {roster.map((rival) => <Pressable key={rival.citizenId} accessibilityRole="button" accessibilityLabel={`Challenge ${rival.pilotName}`} disabled={!!cooldowns[rival.citizenId]} onPress={() => pickRival(rival)} style={styles.rivalRow}>
              <View style={[styles.portraitRing, { borderColor: rival.ringColor }]}><Image source={getHolobotHeadshotImageSource(rival.holobotId)} style={styles.portrait} /></View>
              <View style={{ flex: 1 }}><Text style={styles.rivalName}>{rival.pilotName}</Text><Text style={styles.caption}>{rival.holobotId.toUpperCase()} / {cooldowns[rival.citizenId] ?? rival.rank.toUpperCase()}</Text></View>
              <Text style={[styles.challengeArrow, { color: rival.ringColor }]}>↗</Text>
            </Pressable>)}
            {!roster.length ? <><Text style={styles.body}>The gathering roster is confirmed by the city host. Joining also unlocks Arena entry.</Text><Pressable disabled={loading} accessibilityRole="button" onPress={() => void gather()} style={styles.primary}>{loading ? <ActivityIndicator color={theme.colors.carbon} /> : <Text style={styles.primaryText}>JOIN THE GATHERING</Text>}</Pressable></> : null}
            {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
            {!!roster.length && !fixture ? <Pressable accessibilityRole="button" disabled={loading} onPress={() => void gather()} style={styles.refresh}><Text style={styles.caption}>{loading ? "REFRESHING…" : "REFRESH HOST ROSTER"}</Text></Pressable> : null}
          </View>}
        </ScrollView>
      </View>}
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.carbon }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, gap: 8 },
  kicker: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1.8, marginBottom: 6 }, title: { ...theme.type.header, color: theme.colors.text, fontSize: 24 },
  home: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md }, homeText: { color: theme.colors.accent, fontSize: 30 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, marginTop: 22, marginBottom: 14 }, signal: { flexDirection: "row", alignItems: "center", gap: 7 }, signalDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.colors.accent }, statusText: { ...theme.type.micro, color: theme.colors.muted, letterSpacing: 1.1 },
  mapFrame: { marginHorizontal: 14, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 16, overflow: "hidden" }, mapDistrict: { position: "absolute", width: 94, minHeight: 62, alignItems: "center", zIndex: 2 },
  districtSymbol: { width: 35, height: 35, borderWidth: 1, borderColor: theme.colors.accent, borderRadius: 9, backgroundColor: theme.plates.keycap, alignItems: "center", justifyContent: "center" }, symbolText: { fontSize: 24, color: theme.colors.accent, lineHeight: 30 }, lockedSymbol: { borderColor: theme.colors.disabled }, districtLabel: { ...theme.type.micro, fontSize: 9, lineHeight: 13, color: theme.colors.text, textAlign: "center", backgroundColor: theme.plates.navy, paddingHorizontal: 5, marginTop: 5, borderRadius: 3 },
  rivalPin: { position: "absolute", width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 3 }, rivalDot: { width: 21, height: 21, borderWidth: 2, borderRadius: 11, backgroundColor: theme.plates.keycap, alignItems: "center", justifyContent: "center" }, pinInitial: { ...theme.type.micro, fontSize: 9 },
  mapCaption: { flexDirection: "row", justifyContent: "space-between", marginHorizontal: 22, marginTop: 10 }, caption: { ...theme.type.micro, color: theme.colors.muted, letterSpacing: 0.8 },
  gatheringCard: { marginHorizontal: 20, marginTop: 22, padding: 18, borderColor: theme.colors.border, borderWidth: 1, backgroundColor: theme.plates.navy, borderRadius: theme.radius.md, gap: 12 }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, cardTitle: { ...theme.type.label, color: theme.colors.text }, ringBadge: { ...theme.type.header, color: theme.colors.accent }, body: { ...theme.type.body, color: theme.colors.muted },
  primary: { minHeight: 48, backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, justifyContent: "center", alignItems: "center", padding: 10 }, primaryText: { ...theme.type.label, color: theme.colors.carbon, textAlign: "center", fontSize: 14 },
  message: { ...theme.type.body, color: theme.colors.warning, margin: 20 }, quickRow: { flexDirection: "row", gap: 12, margin: 20 }, quick: { flex: 1, padding: 16, gap: 6, minHeight: 70, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md }, quickTitle: { ...theme.type.label, color: theme.colors.accent },
  sheet: { flex: 1, backgroundColor: theme.colors.carbon }, sheetHeader: { paddingLeft: 22, paddingRight: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: theme.colors.border }, close: { width: 48, height: 48, alignItems: "center", justifyContent: "center" }, closeText: { fontSize: 22, color: theme.colors.accent },
  rivalList: { padding: 22, gap: 12 }, rivalRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.plates.navy }, portraitRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: "center", justifyContent: "center", overflow: "hidden" }, portrait: { width: 48, height: 48, resizeMode: "contain" }, rivalName: { ...theme.type.label, color: theme.colors.text }, challengeArrow: { fontSize: 24 }, refresh: { alignItems: "center", minHeight: 48, justifyContent: "center" },
});
