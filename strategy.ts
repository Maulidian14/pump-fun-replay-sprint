// Overhang-exhaustion paper bot for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// v3: buy the exhaustion, ride the dispersed coins to completion. See
// STRATEGY-v3.md for the full reasoning; the short version, from the FULL dev
// window (all 3 dataset parts, 128,058 events, 1,222 mints):
//   - Generic dip-buying loses (only 16-29% of dips bounce >= +20% in 600
//     slots; ~half fall a further >= 20%). The kit's reversion pilot scores
//     -4.02 SOL on the full window.
//   - 35 coins complete, but 28 complete in their creation slot (untradeable:
//     the harness applies the whole batch before the bot acts, and the 2-slot
//     fill latency kills even the age-1 completer). The 7 tradeable ("slow")
//     completers take 345-2,205 slots, end with 248-1,019 buyers and topShare
//     0.02-0.05, dip 20-65% along the way, and pay 1.4x-11.6x from dip prices.
//   - A dip-RECOVERY (dip >= 30% from peak, then price retakes the old peak)
//     completes 11% of the time (11/99 events); with the dispersion filter
//     (buyers >= 50, topShare <= 0.2, rq >= 15) it is 17% (10/60), median
//     forward max 1.36x. "Stabilisation" triggers (no new low for 50-100
//     slots) are value traps: 2-5% completion, EV -2.4 to -4.4 SOL.
//   - The edge is scale-into-strength, not the entry alone: losers stall
//     early (they never earn adds, so they only ever cost the 0.15 first
//     buy), while winners keep rising and keep earning adds — so deployed
//     capital concentrates into the coins that complete. Adds fire on rq
//     growth (+5 rq above the last buy, price above the last buy's price),
//     up to 2.0 SOL at cost per coin.
//   - Exits ride to completion: NO take-profit; a wide trailing stop (50%
//     below the peak value since entry — completers dip 20-65% mid-ride, so
//     a tight stop kills the winners); stale after 600 slots; max hold 4,000.
//   - Sells are chunked: a sell is rejected when its proceeds exceed the
//     curve's real SOL reserves, so a big position on a collapsed coin gets
//     stuck (this is what killed v2's completion-rider test). Each chunk's
//     proceeds stay under ~50% of current rq.
//
// Everything is a pure function of the batches: no clock, no environment, no
// randomness, so the two graded executions produce byte-identical action logs.
// Iteration is only over insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

/** All tunables of the strategy, in one place. */
export interface Params {
  // -- dip-recovery entry --
  /** A dip arms once the price falls this far below the running peak (fraction). */
  dipMin: number;
  /** ...and the entry fires once the price has retraced this share of the dip
   *  (1.0 = full retake of the old peak). */
  recoverShare: number;
  /** If the price falls below this share of the peak, the dip is a collapse:
   *  reset the peak to the current price (a new regime, not a dip). */
  collapseReset: number;
  /** The peak must have come with at least this much real SOL behind it. */
  minPeakRq: number;
  /** The peak price must be at least this multiple of the create price. */
  minPeakMult: number;
  /** Most slots after the recovery during which the entry may still fire. */
  recoverWindow: number;
  /** Most the price may have run past the recovery price and still be entered. */
  recoverChase: number;
  // -- dispersion filter (lifetime, all trades since creation) --
  /** Fewest distinct non-creator buyers over the coin's whole life. */
  minBuyersDisp: number;
  /** Largest single wallet's share of lifetime buy SOL. */
  maxTopShareDisp: number;
  // -- entry bounds --
  /** Real SOL bounds at entry. */
  minRqEntry: number;
  maxRqEntry: number;
  /** Youngest age (slots since CreateEvent) at which a coin may be bought. */
  minAge: number;
  /** Price over create price, minus 1: lower bound at entry. */
  minMult: number;
  // -- sizing --
  /** First buy of a position (SOL). */
  firstBuySol: number;
  /** Each add-on buy (SOL), clipped by the 1%-of-reserve order cap. */
  addSol: number;
  /** Most SOL at cost in one position. */
  stakeSol: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out wide open. */
  buySlipBps: number;
  /** Add only once real SOL has risen this much above the last buy's rq. */
  addRqStep: number;
  // -- exits --
  /** Sell the whole position once its value reaches cost * (1 + takeProfit).
   *  v3 rides to completion, so this is set so high it effectively never fires. */
  takeProfit: number;
  /** Last-resort floor: sell once value falls to cost * (1 - stopLoss). */
  stopLoss: number;
  /** Trailing stop from the position's best value since entry (fraction). */
  trail: number;
  /** Exit after this many slots held (unless the position is up). */
  maxHold: number;
  /** Exit when no trade has hit the coin for this many slots. */
  staleSlots: number;
  /** Exit on any single recorded sell of at least this many SOL. */
  bigSellSol: number;
  /** Slots to wait after an exit before the same coin may be bought again. */
  cooldown: number;
  /** Most entries per coin over the run. */
  maxEntries: number;
  /** Each sell chunk's proceeds stay under this share of current real SOL. */
  sellChunkRq: number;
  // -- caps and pacing --
  /** Most main positions open at once (the rest of the cap is for probes). */
  maxMain: number;
  /** Guardrail pacing targets. */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
  /** Most SOL at cost across all positions at once (a drawdown guard). */
  maxExposureSol: number;
}

export const DEFAULT_PARAMS: Params = {
  dipMin: 0.3,
  recoverShare: 1.0,
  collapseReset: 0.3,
  minPeakRq: 5,
  minPeakMult: 2.0,
  recoverWindow: 200,
  recoverChase: 1.05,
  minBuyersDisp: 50,
  maxTopShareDisp: 0.4,
  minRqEntry: 15,
  maxRqEntry: 70,
  minAge: 50,
  minMult: 1.5,
  firstBuySol: 0.15,
  addSol: 0.4,
  stakeSol: 3.0,
  minBuySol: 0.01,
  buySlipBps: 1500,
  addRqStep: 3,
  takeProfit: 10,
  stopLoss: 0.7,
  trail: 0.38,
  maxHold: 4000,
  staleSlots: 600,
  bigSellSol: 5,
  cooldown: 0,
  maxEntries: 1,
  sellChunkRq: 0.5,
  maxMain: 5,
  targetCoins: 25,
  targetFills: 60,
  paceSecs: 14_400,
  probeSol: 0.01,
  maxProbes: 1,
  maxExposureSol: 9,
};

const LAMPORTS = 1e9;
/** Curve fees (protocol + creator) charged on each side, as a share of the quote. */
const CURVE_FEE = 0.0125;
const BPS_PER_UNIT = 10_000;
/** Sells always go out wide open. */
const SELL_SLIP_BPS = 10_000;
/** Sentinel for "never exited": far in the past, so the cooldown never blocks. */
const NEVER_EXITED = -1e12;
/** A position held past maxHold only exits while below this multiple of cost. */
const MAX_HOLD_EXIT_BELOW = 1.1;
/** Probes only open on curves with this much real SOL above the bare minimum. */
const PROBE_RESERVE_MARGIN = 1.5;
/** Each sell chunk is at least this share of the position (so an exit finishes). */
const MIN_CHUNK_SHARE = 0.05;

interface Coin {
  created: number | null;
  creator: string | null;
  creatorSold: boolean;
  /** Price at creation (virtual quote / virtual token reserves). */
  createPrice: number;
  /** Distinct non-creator buyers over the coin's whole life. */
  buyers: Set<string>;
  /** Lifetime buy SOL per wallet (creator included), for the dispersion filter. */
  buySolByUser: Map<string, number>;
  /** Lifetime buy SOL across all wallets. */
  totalBuySol: number;
  /** Slot of the most recent trade on this coin. */
  lastTradeSlot: number;
  entries: number;
  lastExit: number;
  // -- dip-recovery state (running peak since creation, or since the last reset) --
  /** Highest trade price seen since the last reset. */
  peakPrice: number;
  /** Real SOL when the peak was set. */
  peakRq: number;
  /** True once the price has dipped dipMin below the peak and not yet recovered. */
  dipped: boolean;
  /** Lowest price seen while dipped (the dip's bottom). */
  dipPrice: number;
  /** The peak the current (or most recent) dip fell from, and its real SOL.
   *  Kept separately from peakPrice because the recovery resets the running
   *  peak to the recovery price. */
  dipPeakPrice: number;
  dipPeakRq: number;
  /** True once the price retraced recoverShare of the dip (armed entry). */
  recovered: boolean;
  /** Price and slot when the recovery fired. */
  recoveryPrice: number;
  recoverySlot: number;
}

interface Held {
  opened: number;
  peakValue: number;
  /** SOL sent in buys for this position (fees included). */
  invested: number;
  exiting: boolean;
  filled: boolean;
  /** Recorded price and real SOL when the last buy was decided. */
  lastAddPrice: number;
  lastAddRq: number;
  /** Close value at the latest batch (SOL, curve and tx fees deducted). */
  lastValue: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** The bot's own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;

  const coinOf = (mint: Pubkey): Coin => {
    let c = coins.get(mint);
    if (c === undefined) {
      c = { created: null, creator: null, creatorSold: false, createPrice: 0, buyers: new Set(), buySolByUser: new Map(), totalBuySol: 0, lastTradeSlot: 0, entries: 0, lastExit: NEVER_EXITED, peakPrice: 0, peakRq: 0, dipped: false, dipPrice: 0, dipPeakPrice: 0, dipPeakRq: 0, recovered: false, recoveryPrice: 0, recoverySlot: 0 };
      coins.set(mint, c);
    }
    return c;
  };

  /** Fold one trade into a coin's dip-recovery state machine. */
  const trackDip = (c: Coin, slot: number, price: number, rq: number): void => {
    if (!c.dipped) {
      if (price > c.peakPrice) {
        c.peakPrice = price;
        c.peakRq = rq;
      }
      if (c.peakPrice > 0 && price <= c.peakPrice * (1 - p.dipMin)) {
        c.dipped = true;
        c.dipPrice = price;
        c.dipPeakPrice = c.peakPrice;
        c.dipPeakRq = c.peakRq;
      }
      return;
    }
    // In a dip: track the bottom, watch for the recovery or a collapse reset.
    if (price < c.dipPrice) c.dipPrice = price;
    const retrace = c.dipPrice + (c.peakPrice - c.dipPrice) * p.recoverShare;
    if (price >= retrace) {
      c.dipped = false;
      c.recovered = true;
      c.recoveryPrice = price;
      c.recoverySlot = slot;
      // The new peak is the recovery price: look for the next dip from here.
      c.peakPrice = price;
      c.peakRq = rq;
      return;
    }
    if (price <= c.peakPrice * p.collapseReset) {
      // A collapse, not a dip: reset the peak and forget the dip.
      c.dipped = false;
      c.peakPrice = price;
      c.peakRq = rq;
    }
  };

  /** Largest single wallet's share of lifetime buy SOL (0 when nothing bought). */
  const topShare = (c: Coin): number => {
    if (c.totalBuySol <= 0) return 0;
    let top = 0;
    for (const v of c.buySolByUser.values()) if (v > top) top = v;
    return top / c.totalBuySol;
  };

  /** Dip-recovery entry signal on a coin's tape at slot `now`. */
  const entrySignal = (c: Coin, now: number, rqSol: number, price: number): boolean => {
    if (!c.recovered) return false;
    if (now - c.recoverySlot > p.recoverWindow) return false;
    if (price > c.recoveryPrice * p.recoverChase) return false;
    if (rqSol < p.minRqEntry || rqSol > p.maxRqEntry) return false;
    if (c.created === null || now - c.created < p.minAge) return false;
    if (c.creatorSold) return false;
    if (c.createPrice <= 0) return false;
    if (price / c.createPrice < p.minMult) return false;
    if (c.dipPeakPrice / c.createPrice < p.minPeakMult) return false;
    if (c.dipPeakRq < p.minPeakRq) return false;
    if (c.buyers.size < p.minBuyersDisp) return false;
    if (topShare(c) > p.maxTopShareDisp) return false;
    return true;
  };

  /** Close value of a position at the current marks (SOL, curve and tx fees deducted). */
  const positionValue = (tokens: number, vq: number, vt: number, tx: number): number =>
    ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;

  /** Tokens to sell so the chunk's proceeds stay under sellChunkRq of real SOL.
   *  A sell is rejected when its proceeds exceed the curve's real reserves, so
   *  a big position on a collapsed coin must exit in chunks. */
  const sellChunkTokens = (tokens: bigint, vq: number, vt: number, rqSol: number): bigint => {
    const targetQ = (p.sellChunkRq * rqSol) / (1 - CURVE_FEE); // SOL out before fees
    const targetLamports = targetQ * LAMPORTS;
    if (targetLamports >= vq) return tokens; // even selling everything stays under the cap
    // Solve t*vq/(vt+t) = targetLamports for t.
    const t = (targetLamports * vt) / (vq - targetLamports);
    let chunk = BigInt(Math.floor(t));
    const minChunk = (tokens * BigInt(Math.round(MIN_CHUNK_SHARE * 100))) / 100n;
    if (chunk < minChunk) chunk = minChunk;
    if (chunk > tokens) chunk = tokens;
    if (chunk <= 0n) chunk = tokens;
    return chunk;
  };

  /** Take-profit: value reached cost * (1 + takeProfit). */
  const hitTakeProfit = (value: number, cost: number): boolean => value >= cost * (1 + p.takeProfit);
  /** Last-resort floor: value fell to cost * (1 - stopLoss). */
  const hitStopLoss = (value: number, cost: number): boolean => value < cost * (1 - p.stopLoss);
  /** Trailing stop from the position's best value since entry, armed from the first mark. */
  const hitTrailingStop = (h: Held, value: number): boolean =>
    h.peakValue > 0 && value < h.peakValue * (1 - p.trail);
  /** Time limit: held past maxHold while below MAX_HOLD_EXIT_BELOW of cost. */
  const heldTooLong = (h: Held, value: number, cost: number, now: number): boolean =>
    now - h.opened > p.maxHold && value < cost * MAX_HOLD_EXIT_BELOW;
  /** Stale: no trade on the coin for staleSlots. */
  const goneStale = (c: Coin, now: number): boolean => now - c.lastTradeSlot > p.staleSlots;

  /** Exit decision for a held position, checks in priority order. */
  const shouldExit = (h: Held, c: Coin, value: number, cost: number, now: number, bigSell: boolean): boolean => {
    if (h.exiting) return true;
    if (hitTakeProfit(value, cost)) return true;
    if (hitStopLoss(value, cost)) return true;
    if (hitTrailingStop(h, value)) return true;
    if (bigSell) return true;
    if (c.creatorSold) return true;
    if (goneStale(c, now)) return true;
    if (heldTooLong(h, value, cost, now)) return true;
    return false;
  };

  /** True when a sell order on this mint is already pending. */
  const hasPendingSell = (state: BotState, mint: Pubkey): boolean => {
    for (const po of state.pending.values()) {
      if (po.order.mint === mint && po.order.side === 'sell') return true;
    }
    return false;
  };

  /** SOL at cost across all open positions (larger of recorded buys and harness cost). */
  const totalExposure = (state: BotState): number => {
    let exposure = 0;
    for (const [mint, h] of held) exposure += Math.max(h.invested, Number(state.positions.get(mint)?.cost_lamports ?? 0n) / LAMPORTS);
    return exposure;
  };

  /** True when a fresh first buy may be opened on this coin right now. */
  const mayEnter = (c: Coin, now: number, rqSol: number, price: number, slotsLeft: number, mainLeft: number): boolean => {
    if (slotsLeft <= 0 || mainLeft <= 0) return false;
    if (c.entries >= p.maxEntries || now - c.lastExit < p.cooldown) return false;
    return entrySignal(c, now, rqSol, price);
  };

  /** Size of an add-on buy for a held position, or null when no add is warranted.
   *  Adds scale into strength: real SOL must have risen addRqStep above the last
   *  buy's rq and the price must be above the last buy's price. */
  const addAmount = (c: Coin, h: Held, mint: Pubkey, price: number, rqSol: number, state: BotState): number | null => {
    if (h.exiting || !h.filled || h.invested >= p.stakeSol - p.minBuySol) return null;
    if (state.positions.get(mint) === undefined) return null;
    if (rqSol < h.lastAddRq + p.addRqStep) return null;
    if (price < h.lastAddPrice) return null;
    return Math.min(p.addSol, p.stakeSol - h.invested);
  };

  /** Which guardrail counters lag the pace at the current clock. */
  const pacingNeed = (): { coins: boolean; fills: boolean } => {
    const pace = Math.min(1, (lastTime! - firstTime!) / p.paceSecs);
    return {
      coins: myCoins.size < Math.ceil(p.targetCoins * pace),
      fills: myFills < Math.ceil(p.targetFills * pace),
    };
  };

  /** Smallest real SOL a curve needs before a probe may open on it. */
  const probeMinReserve = (state: BotState): number =>
    ((p.probeSol * BPS_PER_UNIT) / state.hello.caps.max_order_bps_of_real_reserve) * PROBE_RESERVE_MARGIN;

  /** Count one of the bot's own fills (harness closes excluded). */
  const countFill = (f: { status: string; client_id: string; mint: Pubkey }): void => {
    if (f.status === 'filled' && !f.client_id.startsWith('_')) {
      myFills++;
      myCoins.add(f.mint);
    }
  };

  /** Size a buy in SOL, or null when it is not worth sending. */
  const sizeBuy = (state: BotState, mint: Pubkey, want: number, free: number, exposure: number, tx: number): number | null => {
    const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
    let amount = Math.min(capSol, want, p.maxExposureSol - exposure);
    if (amount > free - tx) amount = free - tx;
    if (amount < p.minBuySol) return null;
    return amount;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const bigSell = new Set<Pubkey>();
      const traded = new Set<Pubkey>();

      // --- intake: count the bot's own fills ---
      for (const f of batch.fills) countFill(f);

      // --- intake: fold the batch's events into the per-coin state ---
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const c = coinOf(e.mint);
          c.created = e.slot;
          c.creator = e.creator;
          c.createPrice = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
        } else if (e.event === 'TradeEvent') {
          const c = coinOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          const price = Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves);
          const rq = Number(e.real_quote_reserves) / LAMPORTS;
          c.lastTradeSlot = e.slot;
          traded.add(e.mint);
          if (e.is_buy) {
            c.buySolByUser.set(e.user, (c.buySolByUser.get(e.user) ?? 0) + sol);
            c.totalBuySol += sol;
            if (e.user !== c.creator) c.buyers.add(e.user);
          }
          if (!e.is_buy && sol >= p.bigSellSol) bigSell.add(e.mint);
          if (!e.is_buy && c.creator !== null && e.user === c.creator) c.creatorSold = true;
          trackDip(c, e.slot, price, rq);
        }
      }

      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // --- phase 1: exits first (chunked sells) ---
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            const c = coinOf(mint);
            if (h.filled) c.lastExit = now;
            else c.entries--;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        const value = positionValue(Number(pos.token_amount), vq, vt, tx);
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        const c = coinOf(mint);
        if (!shouldExit(h, c, value, cost, now, bigSell.has(mint))) continue;
        h.exiting = true;
        if (pendingByMint.has(mint) && hasPendingSell(state, mint)) continue;
        if (orders.length >= cap) break;
        const chunk = sellChunkTokens(pos.token_amount, vq, vt, rqSol);
        orders.push({ side: 'sell', mint, token_amount: chunk, max_slippage_bps: SELL_SLIP_BPS });
      }

      // --- phase 2: probe round trips — sell the whole probe once its buy has landed ---
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: SELL_SLIP_BPS });
        if (!selling) probes.set(mint, true);
      }

      // --- phase 3: entries and adds ---
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      let mainLeft = p.maxMain - held.size;
      let exposure = totalExposure(state);
      for (const mint of traded) {
        if (orders.length >= cap) break;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (pendingByMint.has(mint) || probes.has(mint)) continue;
        const c = coins.get(mint)!;
        const h = held.get(mint);
        const price = Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        let want: number;
        if (h === undefined) {
          if (!mayEnter(c, now, rqSol, price, slotsLeft, mainLeft)) continue;
          want = p.firstBuySol;
        } else {
          // Add into strength only: real SOL climbed a step past the last buy
          // and the price is above the last buy's price.
          const add = addAmount(c, h, mint, price, rqSol, state);
          if (add === null) continue;
          want = add;
        }
        const amount = sizeBuy(state, mint, want, free, exposure, tx);
        if (amount === null) continue;
        orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        if (h === undefined) {
          held.set(mint, { opened: now, peakValue: 0, invested: amount, exiting: false, filled: false, lastAddPrice: price, lastAddRq: rqSol, lastValue: 0 });
          c.entries++;
          slotsLeft--;
          mainLeft--;
        } else {
          h.invested += amount;
          h.lastAddPrice = price;
          h.lastAddRq = rqSol;
        }
      }

      // --- phase 4: guardrail pacing — open a probe when fills or coins lag the pace ---
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const need = pacingNeed();
        if (need.coins || need.fills) {
          const minProbeRq = probeMinReserve(state);
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (need.coins && !need.fills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minProbeRq) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
