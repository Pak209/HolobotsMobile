import { AppState, NativeEventEmitter, NativeModules } from 'react-native';
import { auth, functions, httpsCallable } from '@/config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { connectWildBridge, type Command, type NativeWildPort } from './wildBridge';
import { subscribeTravelSquadSnapshots, publishTravelSquadSnapshot, travelSquadInvoker } from '../travelSquadFirebase';
import { readTravelSquad } from '../travelSquadClient';

let activeClose: (() => Promise<void>) | undefined;
/** Full-screen native Unity entry. Await real ready + attached + host refresh, never invent a runtime. */
export async function openNativeUnity(): Promise<() => Promise<void>> {
  if (activeClose) throw new Error('Unity is already open');
  const native = NativeModules.HolobotsUnityRuntime;
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in before entering HoloCity');
  if (!native) throw new Error('This build does not include the native Unity module');
  const sessionId = `native_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let closed = false, begun = false, attached = false;
  let ended: (() => void) | undefined, closing: Promise<void> | undefined;
  let stopAuth = () => {}, stopSquad = () => {}, disconnect = () => {};
  let subscription: { remove(): void } | undefined, appState: { remove(): void } | undefined;
  const listeners = new Set<(json: string) => void>();
  let readyResolve!: () => void, readyReject!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve=resolve;readyReject=reject; });
  // Register rejection immediately: native.open itself may be asynchronous while auth closes this session.
  void ready.catch(() => {});
  const deadline = setTimeout(() => fail(new Error('HoloCity did not become ready. Try again.')), 15000);
  const emitter = new NativeEventEmitter(native);
  const send = (value: unknown) => {
    if (closed || auth.currentUser?.uid !== uid) return Promise.reject(new Error('Session closed'));
    return native.send(JSON.stringify(value));
  };
  function fail(error: unknown) { readyReject(error); void close().catch(() => {}); }
  function close(): Promise<void> {
    if (closing) return closing;
    closed = true;clearTimeout(deadline);readyReject(new Error('HoloCity session closed'));
    disconnect();stopSquad();appState?.remove();stopAuth();listeners.clear();
    closing = (async () => {
      try {
        if (begun) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await new Promise<void>(resolve => {
              ended=resolve;timer=setTimeout(resolve,2000);
              void native.send(JSON.stringify({schemaVersion:'native-session-1',sessionId,operation:'end'})).catch(resolve);
            });
          } finally { if(timer)clearTimeout(timer);ended=undefined; }
        }
      } finally {
        // Removing the last listener pauses the native runtime: keep it until end acknowledgement/timeout.
        subscription?.remove();
        try { await native.close(); } finally { if(activeClose===close)activeClose=undefined; }
      }
    })();
    return closing;
  }
  activeClose=close;
  const port: NativeWildPort = {
    subscribe: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    send: json => { if (!closed && attached && auth.currentUser?.uid === uid) void native.send(json).catch(fail); },
  };
  const callable = httpsCallable<Command, unknown>(functions, 'wildEncounterHost');
  disconnect = connectWildBridge({port,sessionId,isSignedIn:()=>!closed && attached && auth.currentUser?.uid===uid,
    invoke:async command=> {
      const response=await callable(command);
      if (auth.currentUser?.uid!==uid || closed) throw {code:'unauthenticated'};
      const squad=(response.data as {travelSquad?:unknown})?.travelSquad;
      if(squad)publishTravelSquadSnapshot(uid,squad);
      return response.data;
    }});
  stopSquad=subscribeTravelSquadSnapshots(update=>{
    if(attached && !closed && update.uid===uid && auth.currentUser?.uid===uid)void send({schemaVersion:'native-squad-1',sessionId,travelSquad:readTravelSquad(update.snapshot)}).catch(fail);
  });
  subscription=emitter.addListener('UnityMessage',({json}:{json:string})=>{
    if(typeof json!=='string' || json.length>262144)return;
    let message:any;try{message=JSON.parse(json);}catch{return;}
    if(!message || typeof message!=='object' || Array.isArray(message))return;
    if(message.schemaVersion==='native-session-1' && message.sessionId===sessionId && message.operation==='ended'){if(closed)ended?.();return;}
    if(closed || auth.currentUser?.uid!==uid)return;
    if(message.schemaVersion==='runtime-exit-1'){void close().catch(()=>{});return;}
    if(message.schemaVersion==='runtime-ready-1' && !begun){
      begun=true;
      void send({schemaVersion:'native-session-1',sessionId,operation:'begin'}).catch(fail);
    }else if(message.schemaVersion==='native-session-1' && message.sessionId===sessionId && message.operation==='attached' && begun && !attached){
      attached=true;
      void travelSquadInvoker(uid)({operation:'refresh'}).then(reply=>{
        if(closed || auth.currentUser?.uid!==uid)return;
        publishTravelSquadSnapshot(uid,readTravelSquad((reply as {travelSquad:unknown}).travelSquad));
        clearTimeout(deadline);readyResolve();
      }).catch(fail);
    }else if(attached && message.schemaVersion==='wild-bridge-1' && message.sessionId===sessionId){
      for(const listener of listeners)listener(json);
    }
  });
  appState=AppState.addEventListener('change',state=>{
    if(closed)return;
    void (state==='active'?native.resume():native.pause()).catch(fail);
  });
  stopAuth=onAuthStateChanged(auth,user=>{if(user?.uid!==uid)fail(new Error('Sign-in changed. Reopen HoloCity.'));});
  try { await Promise.race([native.open(),ready]);await ready; } catch(error) { try { await close(); } catch { /* preserve launch error */ } throw error; }
  return close;
}
export async function closeNativeUnity(){await activeClose?.();}
