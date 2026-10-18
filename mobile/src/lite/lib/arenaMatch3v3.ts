/** arena-match-3v3-1 strict reader and bench presenter (PROPOSAL contract, HolobotsMobile #134).
 * No host implements 3v3 yet and nothing calls this live. The host owns every vital, the turn, the phase
 * and the outcome. This module only reads the reply and never derives HP, STA, regen or level. */
/** lite-main-port-2: main carries only what lite #144 needs from #139 here (the 3v3 copy for ArenaScreen's honest entry and
 * the swap type behind ArenaMatchFlow's constructor slot). The reader, bench presenters and their tests stay on lite. */
export const ARENA_3V3_SCHEMA = 'arena-match-3v3-1';
/** Every player-visible 3v3 string. PLACEHOLDER copy until Lex. Per DECISIONS #71 the on-screen authority is
 * "the City"; the word "host" never appears on screen (code identifiers and comments may keep it). */
export const ARENA_3V3_COPY = {
    unavailable: '3v3 isn’t open yet. The City admits one fighter per match today, so 3v3 can’t start and nothing is charged.',
    benchLabel: '3v3 bench, City roster',
    swapIn: 'SWAP IN',
    asking: 'ASKING THE CITY…',
    askLabel: (name: string) => `Ask the City to swap in ${name}`,
    buddyLabel: 'BUDDY',
    buddyEmpty: 'NO BUDDY UNIT FROM YOUR ACCOUNT YET',
    admitted: 'ADMITTED · WAITING FOR START',
    turn: (turn: number) => `TURN ${turn}`,
    sendIn: 'SEND IN A FIGHTER',
    swaps: (used: number, limit: number) => `SWAPS ${used}/${limit}`,
    over: 'MATCH OVER',
    receipt: (won: boolean) => `CITY RECEIPT · ${won ? 'WIN' : 'LOSS'}`,
    closed: (state: string) => `CITY CLOSED · ${state.toUpperCase()}`,
} as const;
export const ARENA_3V3_UNAVAILABLE_COPY = ARENA_3V3_COPY.unavailable;
export type Arena3v3Swap = { schemaVersion: typeof ARENA_3V3_SCHEMA; operation: 'swap'; matchId: string; intentId: string; turn: number; holobotId: string };
