from pathlib import Path
import re,subprocess,json
r=Path('/private/tmp/astra-mobile-session');m=r/'mobile';flag=m/'src/config/liteFeature.ts'
assert r.resolve() == Path("/private/tmp/astra-mobile-session"), "Refuse a different checkout"
assert subprocess.check_output(["git", "-C", str(r), "branch", "--show-current"], text=True).strip() == "codex/lite-main-integration-1", "Refuse foreign branch"
assert not flag.exists(), "Refuse rerun over generated gates"
flag.write_text('''/** Build-time opt-in; missing or malformed values fail closed. */
export function isLiteEnabled(): boolean { return process.env.EXPO_PUBLIC_HOLOCITY_LITE === "1"; }
export function isLitePreviewEnabled(): boolean { return isLiteEnabled() && typeof __DEV__ !== "undefined" && __DEV__ && process.env.EXPO_PUBLIC_HOLOCITY_PREVIEW === "1"; }
''')
(m/'App.tsx').write_text('''import { lazy, Suspense } from "react";
import { isLiteEnabled } from "./src/config/liteFeature";
export type { RootTabs } from "./MainApp";
const MainApp = lazy(() => import("./MainApp"));
const LiteApp = lazy(() => import("./LiteApp"));
/** Disabled builds never evaluate the lite application or its consumers. */
export default function App() {
  const Selected = isLiteEnabled() ? LiteApp : MainApp;
  return <Suspense fallback={null}><Selected /></Suspense>;
}
''')
p=m/'src/config/firebase.ts';s=p.read_text();s='import { isLitePreviewEnabled } from "./liteFeature";\n'+s;s=s.replace('import { initializeApp, getApps }', 'import { initializeApp, getApps, getApp }');s=s.replace('const offlinePreview = __DEV__ && process.env.EXPO_PUBLIC_HOLOCITY_PREVIEW === "1";','const offlinePreview = isLitePreviewEnabled();');s=s.replace('const existingApp = getApps().find(candidate => candidate.name === (offlinePreview ? "holocity-offline" : "[DEFAULT]"));','const existingApp = offlinePreview ? getApps().find(candidate => candidate.name === "holocity-offline") : undefined;');s=s.replace('const app = existingApp ?? (offlinePreview\n  ? initializeApp(','const app = offlinePreview ? (existingApp ?? initializeApp(').replace('"holocity-offline")\n  : initializeApp(firebaseConfig));','"holocity-offline"))\n  : (getApps().some(candidate => candidate.name === "[DEFAULT]") ? getApp() : initializeApp(firebaseConfig));');p.write_text(s)
p=m/'src/contexts/AuthContext.tsx';s=p.read_text();s='import { isLitePreviewEnabled } from "@/config/liteFeature";\n'+s;s=s.replace('if (!__DEV__) throw new Error("Offline preview is only available in development builds.");','if (!isLitePreviewEnabled()) throw new Error("Offline preview requires the lite development preview gates.");');p.write_text(s)
for file,old,new in [('src/lib/profile.ts','storyFlags: readCityStoryFlags(data.storyFlags),','...(isLiteEnabled() ? { storyFlags: readCityStoryFlags(data.storyFlags) } : {}),'),('src/config/holobots.ts','hostRank: rawHolobot.rank,','...(isLiteEnabled() ? { hostRank: rawHolobot.rank } : {}),')]:
 p=m/file;s='import { isLiteEnabled } from "@/config/liteFeature";\n'+p.read_text();assert old in s;s=s.replace(old,new);p.write_text(s)
p=m/'LiteApp.tsx';s=p.read_text();s='import { isLiteEnabled, isLitePreviewEnabled } from "./src/config/liteFeature";\n'+s;s=s.replace('export default function App() {','function EnabledLiteApp() {');s=s.replace('__DEV__ && process.env.EXPO_PUBLIC_HOLOCITY_PREVIEW === "1"','isLitePreviewEnabled()');s+='\nexport default function LiteApp() { return isLiteEnabled() ? <EnabledLiteApp /> : null; }\n';p.write_text(s)
# Lightweight exports defer all route imports until an enabled mount.
for rel,names in [('screens/CityHubScreen.tsx',['CityHubScreen']),('screens/DuelPlaybackScreen.tsx',['DuelPlaybackScreen','FighterHud']),('qa/HoloCityPreview.tsx',['HoloCityPreviewApp']),('qa/ArenaHostLevelsPreview.tsx',['ArenaHostLevelsPreview','ArenaHostLevelsKnownBadPreview']),('qa/ArenaAdmittedPreview.tsx',['ArenaAdmittedRoundPreview','ArenaAdmittedResultPreview','ArenaAdmittedKnownBadPreview'])]:
 p=m/'src/lite'/rel;inner=p.with_name('Enabled'+p.name);p.rename(inner);stem=inner.stem;out='import { lazy, Suspense } from "react";\nimport { isLiteEnabled } from "@/config/liteFeature";\n'
 out+=f'export type * from "./{stem}";\n'
 for name in names:
  out+=f'const Lazy{name} = lazy(() => import("./{stem}").then(m => ({{ default: m.{name} }})));\n'
  if name in ['CityHubScreen','DuelPlaybackScreen','FighterHud']:
   out+=f'export function {name}(props: Parameters<typeof import("./{stem}").{name}>[0]'+(' = {}' if name=='CityHubScreen' else '')+f') {{ return isLiteEnabled() ? <Suspense fallback={{null}}><Lazy{name} {{...props}} /></Suspense> : null; }}\n'
  else:out+=f'export function {name}() {{ return isLiteEnabled() ? <Suspense fallback={{null}}><Lazy{name} /></Suspense> : null; }}\n'
 p.write_text(out)
# Resolve union-only package conflicts without dependency installation.
for rel in ['package.json','package-lock.json']:
 p=m/rel;s=p.read_text();s=re.sub(r'^<<<<<<<.*\n|^=======\n|^>>>>>>>.*\n','',s,flags=re.M);json.loads(s);p.write_text(s)
# Native configuration belongs to main, independent of the JS rollout flag.
for f in subprocess.check_output(['git','-C',str(r),'ls-tree','-r','--name-only','origin/main','mobile/ios','mobile/android','mobile/app.json'],text=True).splitlines():
 p=r/f;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(subprocess.check_output(['git','-C',str(r),'show','origin/main:'+f]))
print('Gate and main-native preservation prepared')
