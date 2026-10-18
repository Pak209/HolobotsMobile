import { CityRivalBattle } from "@/lite/components/city/CityRivalBattle";
import { CITY_GATHERING_FIXTURE } from "@/lite/lib/cityHubFixtures";

/**
 * Offline QA only (holobotsmobile://qa/CityBattle): the fixture duel opens straight into combat.
 * It lives under qa/ so the gathering fixture never ships in a release bundle (F11).
 */
export function CityRivalCombatPreview({ onClose }: { onClose: () => void }) {
  return <CityRivalBattle uid="offline-city-preview" rival={CITY_GATHERING_FIXTURE.roster[0]} onClose={onClose} preview initialCombat />;
}
