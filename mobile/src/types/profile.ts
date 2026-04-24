export type SyncStats = {
  power: number;
  guard: number;
  tempo: number;
  focus: number;
  bond: number;
};

export type SyncRank = "Rookie" | "Walker" | "Pilot" | "Strider" | "Champion" | "Legend";

export type UserHolobot = {
  name: string;
  level: number;
  experience: number;
  nextLevelExp: number;
  boostedAttributes?: {
    attack?: number;
    defense?: number;
    special?: number;
    speed?: number;
    health?: number;
  };
  rank?: string;
  attributePoints?: number;
  receivedLegendaryBonus?: boolean;
  prestiged?: boolean;
  pvpWins?: number;
  pvpLosses?: number;
  syncStats?: SyncStats;
  syncAbilityUnlocks?: string[];
  syncLevel?: number;
  lifetimeSPInvested?: number;
};

export type UserProfile = {
  id: string;
  username: string;
  holobots: UserHolobot[];
  dailyEnergy: number;
  maxDailyEnergy: number;
  holosTokens: number;
  gachaTickets: number;
  stats: {
    wins: number;
    losses: number;
  };
  lastEnergyRefresh: string;
  level?: number;
  arena_passes?: number;
  exp_boosters?: number;
  energy_refills?: number;
  rank_skips?: number;
  async_battle_tickets?: number;
  last_async_ticket_refresh?: string;
  blueprints?: Record<string, number>;
  inventory?: Record<string, number>;
  parts?: Array<Record<string, unknown>>;
  equippedParts?: Record<string, Record<string, Record<string, unknown>>>;
  pack_history?: Array<Record<string, unknown>>;
  battle_cards?: Record<string, number>;
  starter_deck_claimed?: boolean;
  arena_deck_template_ids?: string[];
  rewardSystem?: Record<string, unknown>;
  isDevAccount?: boolean;
  rental_holobots?: Array<Record<string, unknown>>;
  syncPoints?: number;
  leaderboardScore?: number;
  prestigeCount?: number;
  onboardingPath?: string;
  todaySteps?: number;
  lastStepSync?: string;
  lastFitnessSyncAt?: string;
  fitnessSource?: string;
  syncDistanceUnit?: "km" | "mi";
  lifetimeSyncPoints?: number;
  seasonSyncPoints?: number;
  syncRank?: SyncRank;
};
