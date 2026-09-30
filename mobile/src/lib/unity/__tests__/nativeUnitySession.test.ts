import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({
 auth:{currentUser:{uid:'a'} as {uid:string}|null}, event:undefined as ((v:any)=>void)|undefined,
 authListener:undefined as ((u:any)=>void)|undefined, app:undefined as ((v:string)=>void)|undefined,
 squadListener:undefined as ((v:any)=>void)|undefined, port:undefined as any,
 open:vi.fn(),send:vi.fn(),pause:vi.fn(),resume:vi.fn(),close:vi.fn(),call:vi.fn(),refresh:vi.fn(),
 stopAuth:vi.fn(),stopSquad:vi.fn(),disconnect:vi.fn(),remove:vi.fn(),removeApp:vi.fn(),order:[] as string[],nativePresent:true,
}));
vi.mock('react-native',()=>({
 NativeModules:{get HolobotsUnityRuntime(){return m.nativePresent?{open:m.open,send:m.send,pause:m.pause,resume:m.resume,close:m.close}:undefined;}},
 NativeEventEmitter:class{addListener(_name:string,cb:(v:any)=>void){m.event=cb;return{remove:()=>{m.order.push('remove');m.remove();}};}},
 AppState:{addEventListener(_name:string,cb:(v:string)=>void){m.app=cb;return{remove:m.removeApp};}},
}));
vi.mock('@/config/firebase',()=>({auth:m.auth,functions:{},httpsCallable:()=>m.call}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_a:any,cb:(u:any)=>void)=>{m.authListener=cb;return m.stopAuth;}}));
vi.mock('../wildBridge',()=>({connectWildBridge:(o:any)=>{m.port=o.port;return m.disconnect;}}));
vi.mock('../../travelSquadFirebase',()=>({
 subscribeTravelSquadSnapshots:(cb:(v:any)=>void)=>{m.squadListener=cb;return m.stopSquad;},
 publishTravelSquadSnapshot:(uid:string,snapshot:any)=>m.squadListener?.({uid,snapshot}),
 travelSquadInvoker:()=>m.refresh,
}));
import {openNativeUnity,closeNativeUnity} from '../nativeUnitySession';
const squad={schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']};
const emit=(x:any)=>m.event?.({json:typeof x==='string'?x:JSON.stringify(x)});
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const sent=()=>m.send.mock.calls.map(x=>JSON.parse(x[0]));
const session=()=>sent().filter(x=>x.operation==='begin').at(-1).sessionId;
async function attach(){const opening=openNativeUnity();await tick();emit({schemaVersion:'runtime-ready-1'});await tick();emit({schemaVersion:'native-session-1',sessionId:session(),operation:'attached'});return await opening;}
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();m.nativePresent=true;m.auth.currentUser={uid:'a'};m.order=[];
 m.open.mockResolvedValue(true);m.pause.mockResolvedValue(true);m.resume.mockResolvedValue(true);m.close.mockImplementation(async()=>{m.order.push('close');});
 m.refresh.mockResolvedValue({travelSquad:squad});
 m.send.mockImplementation(async(json:string)=>{const x=JSON.parse(json);m.order.push(x.operation??x.schemaVersion);if(x.operation==='end')queueMicrotask(()=>emit({...x,operation:'ended'}));});
});
afterEach(async()=>{const closing=closeNativeUnity();await vi.advanceTimersByTimeAsync(2100);await closing.catch(()=>{});vi.useRealTimers();});
describe('native Unity session',()=>{
 it('waits for actual ready then matching attached before host refresh',async()=>{
  const pending=openNativeUnity();let done=false;void pending.then(()=>{done=true;});await tick();expect(m.send).not.toHaveBeenCalled();expect(m.refresh).not.toHaveBeenCalled();
  emit({schemaVersion:'runtime-ready-1'});await tick();expect(sent()[0].operation).toBe('begin');expect(m.refresh).not.toHaveBeenCalled();expect(done).toBe(false);
  emit({schemaVersion:'native-session-1',sessionId:'foreign',operation:'attached'});await tick();expect(m.refresh).not.toHaveBeenCalled();
  emit({schemaVersion:'native-session-1',sessionId:session(),operation:'attached'});await pending;expect(m.refresh).toHaveBeenCalledOnce();
  expect(sent().at(-1)).toMatchObject({schemaVersion:'native-squad-1',travelSquad:squad});
 });
 it('rejects unavailable native runtime without a mock fallback',async()=>{
  m.nativePresent=false;await expect(openNativeUnity()).rejects.toThrow('native Unity module');expect(m.open).not.toHaveBeenCalled();
  m.nativePresent=true;m.open.mockRejectedValue(new Error('UnityFramework missing'));await expect(openNativeUnity()).rejects.toThrow('UnityFramework missing');expect(m.close).toHaveBeenCalledOnce();
 });
 it('requires signed in user',async()=>{m.auth.currentUser=null;await expect(openNativeUnity()).rejects.toThrow('Sign in');expect(m.open).not.toHaveBeenCalled();});
 it('sends only current uid squad snapshots',async()=>{
  await attach();m.send.mockClear();m.squadListener?.({uid:'b',snapshot:squad});expect(m.send).not.toHaveBeenCalled();
  m.squadListener?.({uid:'a',snapshot:squad});await tick();expect(sent()).toHaveLength(1);
 });
 it('keeps native listener alive until end acknowledgement then closes',async()=>{
  const close=await attach();m.send.mockImplementation(async()=>{});m.order=[];
  const closing=close();await tick();expect(m.remove).not.toHaveBeenCalled();expect(m.close).not.toHaveBeenCalled();
  emit({schemaVersion:'native-session-1',sessionId:session(),operation:'ended'});await closing;expect(m.order).toEqual(['remove','close']);
  expect(m.disconnect).toHaveBeenCalledOnce();expect(m.stopAuth).toHaveBeenCalledOnce();expect(m.stopSquad).toHaveBeenCalledOnce();
 });
 it('bounds missing end acknowledgement and shares close completion',async()=>{
  const close=await attach();m.send.mockImplementation(async()=>{});const a=close(),b=close();expect(a).toBe(b);
  await vi.advanceTimersByTimeAsync(1999);expect(m.close).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);await a;expect(m.close).toHaveBeenCalledOnce();
 });
 it('invalidates on account change and ignores delayed gameplay',async()=>{
  await attach();const forward=vi.fn();m.port.subscribe(forward);const id=session();m.auth.currentUser={uid:'b'};m.authListener?.({uid:'b'});
  emit({schemaVersion:'wild-bridge-1',sessionId:id,requestId:'late',operation:'refresh'});m.squadListener?.({uid:'a',snapshot:squad});await tick();
  expect(forward).not.toHaveBeenCalled();expect(m.disconnect).toHaveBeenCalledOnce();
 });
 it('ignores malformed messages and foreign/stale session messages',async()=>{
  await attach();const forward=vi.fn();m.port.subscribe(forward);emit('null');emit('[]');emit('{bad');emit({schemaVersion:'wild-bridge-1',sessionId:'old'});expect(forward).not.toHaveBeenCalled();
  emit({schemaVersion:'wild-bridge-1',sessionId:session(),operation:'refresh'});expect(forward).toHaveBeenCalledOnce();
 });
 it('pauses and resumes for app state only while open',async()=>{
  const close=await attach();m.app?.('background');m.app?.('active');await tick();expect(m.pause).toHaveBeenCalledOnce();expect(m.resume).toHaveBeenCalledOnce();await close();m.app?.('active');expect(m.resume).toHaveBeenCalledOnce();
 });
 it('times out missing ready and frees the single-runtime session guard',async()=>{
  const pending=openNativeUnity();const check=expect(pending).rejects.toThrow('did not become ready');await vi.advanceTimersByTimeAsync(15000);await check;expect(m.close).toHaveBeenCalledOnce();await attach();
 });
 it('native back button performs the acknowledged close sequence',async()=>{
  await attach();m.order=[];emit({schemaVersion:'runtime-exit-1'});await tick();
  expect(m.order).toEqual(['end','remove','close']);expect(m.disconnect).toHaveBeenCalledOnce();
 });
 it('bounds a native open call that never settles',async()=>{
  m.open.mockImplementation(()=>new Promise(()=>{}));const pending=openNativeUnity();const check=expect(pending).rejects.toThrow('did not become ready');await vi.advanceTimersByTimeAsync(15000);await check;expect(m.close).toHaveBeenCalledOnce();
 });
 it('clears the singleton guard even when native close fails',async()=>{
  const close=await attach();m.close.mockRejectedValueOnce(new Error('native teardown failure'));await expect(close()).rejects.toThrow('native teardown failure');await attach();
 });
 it('fails closed when authenticated host refresh is unavailable',async()=>{
  m.refresh.mockRejectedValue(new Error('Host unavailable'));const pending=openNativeUnity();const check=expect(pending).rejects.toThrow('Host unavailable');await tick();emit({schemaVersion:'runtime-ready-1'});await tick();emit({schemaVersion:'native-session-1',sessionId:session(),operation:'attached'});await check;expect(m.close).toHaveBeenCalledOnce();
 });
});
