import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } as {uid:string}|null }, call: vi.fn() }));
vi.mock('@/config/firebase', () => ({ auth:mocks.auth, functions:{}, httpsCallable:()=>mocks.call }));
import { publishTravelSquadSnapshot, subscribeTravelSquadSnapshots, travelSquadInvoker } from '../travelSquadFirebase';
const snapshot = () => ({ schemaVersion:'travel-squad-1', revision:2, holobotIds:['ace'] });
beforeEach(()=>{mocks.auth.currentUser={uid:'a'};mocks.call.mockReset();});
describe('authenticated travel squad transport',()=>{
 it('forwards only through authenticated callable',async()=>{
  mocks.call.mockResolvedValue({data:{ok:true}});await expect(travelSquadInvoker('a')({operation:'refresh'})).resolves.toEqual({ok:true});
  expect(mocks.call).toHaveBeenCalledWith({operation:'refresh'});
 });
 it('does not request another account squad',async()=>{
  await expect(travelSquadInvoker('b')({operation:'refresh'})).rejects.toMatchObject({code:'unauthenticated'});expect(mocks.call).not.toHaveBeenCalled();
 });
 it('drops a response after logout or account switch',async()=>{
  let resolve!:(v:unknown)=>void;mocks.call.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const pending=travelSquadInvoker('a')({operation:'refresh'});mocks.auth.currentUser={uid:'b'};resolve({data:{secret:'a'}});
  await expect(pending).rejects.toMatchObject({code:'unauthenticated'});
 });
 it('publishes uid-tagged validated copies and unsubscribe removes observer',()=>{
  const observer=vi.fn();const off=subscribeTravelSquadSnapshots(observer);const value=snapshot();
  publishTravelSquadSnapshot('b',value);expect(observer).not.toHaveBeenCalled();
  publishTravelSquadSnapshot('a',value);value.holobotIds[0]='wolf';expect(observer.mock.calls[0][0]).toEqual({uid:'a',snapshot:snapshot()});
  off();publishTravelSquadSnapshot('a',snapshot());expect(observer).toHaveBeenCalledTimes(1);
 });
 it('bad snapshots never reach native observers',()=>{
  const observer=vi.fn();const off=subscribeTravelSquadSnapshots(observer);
  try{expect(()=>publishTravelSquadSnapshot('a',{...snapshot(),holobotIds:['ace','ace']})).toThrow();expect(observer).not.toHaveBeenCalled();}finally{off();}
 });
});
