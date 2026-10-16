import { HttpsError } from 'firebase-functions/v2/https';
import { ExpeditionError } from './expedition';
import { HealthError } from '../lib/rivalHealth';
import { RepairError } from '../lib/repairItems';
import { StoryError } from '../story/storyFlags';
import { HostError } from '../acquisition/wildEncounterDomain';
import { HoloZoneError } from '../lib/holoZoneRuns';
import { RivalError } from '../lib/rivalLadder';

/** Only recognized domain errors cross the callable boundary. Unexpected exceptions remain internal. */
export function expeditionRejection(error:unknown):HttpsError|null {
  let code:string,details:Record<string,unknown>={};
  if(error instanceof ExpeditionError){code=error.code;details=error.details;}
  else if(error instanceof HealthError)code=['holobot_ko','invalid_request','unavailable'].includes(error.message)?error.message:'unavailable';
  else if(error instanceof RepairError||error instanceof StoryError||error instanceof HostError||error instanceof HoloZoneError||error instanceof RivalError)code=error.code;
  else return null;
  return new HttpsError(code==='invalid_request'||code==='invalid_intents'?'invalid-argument':code==='unknown_run'?'not-found':code==='unavailable'?'unavailable':'failed-precondition',code,{rejectionCode:code,...details});
}
