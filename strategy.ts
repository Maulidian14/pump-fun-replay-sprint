// Fast whale-pump paper bot for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// v2: catch the whale pump, bank +25%, get out before the dump. See
// STRATEGY-v2.md for the full reasoning; the short version, from the FULL dev
// window (all 3 dataset parts, 128,058 events, 1,222 mints — the kit sim only
// reads part-00000, which is why v1's sim and grade-local disagreed so much):
//   - The first v2 thesis was backwards. Completers are NOT broad and organic:
//     at rq 12, coins with 0-5 buyers complete 28% of the time, coins with
//     40+ buyers 0%; topShare 0.4-0.6 completes 25% vs 2% for 0-0.2; age 0-20
//     completes 16% vs 0% for age 60+. Completers are fast, whale-driven coins
//     that rocket to rq 12 in ~0 slots with ~4 buyers and a dominant whale.
//   - The entry filter therefore selects whale pumps, not survivors: age 0-30,
//     real SOL 12-45, 1-8 lifetime buyers, price >= 2x create, window top
//     share >= 0.4, price within 5% of its 100-slot high. 50 coins qualify;
//     only 1 completes, so the edge is NOT completion — it is that whale pumps
//     reliably run a further +25-30% before dumping, and the take-profit banks it.
//   - Exits are tight and asymmetric: take profit +25% (the flat peak of the
//     TP curve: 0.25-0.30 both give +0.14 on the strict filter), stop loss
//     -25% (a 15% stop cuts winners mid-dip), exit on any single >= 3 SOL
//     sell (the whale leaving), stale after 200 slots, max hold 600.
//     The trailing stop never fires on this config; pyramiding (adds) hurts.
//   - One 0.15 SOL buy per coin, no adds: the 1% of real reserve order cap
//     clips it to ~0.12 SOL at rq 12 anyway, and bigger size loses more.
//   - Guardrail probes are OFF (targetCoins/targetFills 0): the 50 main
//     entries clear the >= 20 coin guardrail on their own, and the probes
//     were a -0.07 SOL drag that also stole position slots.
//
// Everything is a pure function of the batches: no clock, no environment, no
// randomness, so the two graded executions produce byte-identical action logs.
// Iteration is only over insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

/** All tunables of the strategy, in one place. */
export interface Params {
  // -- entry windows --
  /** Flow window in slots for the entry tape stats. */
  window: number;
  /** Window in slots for the near-high check. */
  highWindow: number;
  /** Youngest age (slots since CreateEvent) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  // -- strength filter --
  /** Real SOL bounds at entry. */
  minRealSol: number;
  maxRealSol: number;
  /** Distinct non-creator buyers over the coin's whole life. */
  minBuyers: number;
  /** Most distinct lifetime buyers (0 = no cap). On this tape completers are
   *  whale-driven: at rq 12, coins with 0-5 buyers complete 28% of the time,
   *  coins with 40+ buyers 0%. A low cap is the real anti-farm filter. */
  maxBuyers: number;
  /** Price over create price, minus 1: lower and upper bounds. */
  minMult: number;
  maxMult: number;
  /** Net buy SOL (buys minus sells) over the flow window. */
  minNetSol: number;
  /** Buy trades in the flow window. */
  minBuys: number;
  /** Distinct buying wallets in the flow window. */
  minWindowBuyers: number;
  /** Price now at least this share of the high over highWindow. */
  nearHigh: number;
  /** Largest single wallet's share of the window's buy SOL (wallet-farm filter). */
  maxTopShare: number;
  /** Smallest single wallet's share of the window's buy SOL (0 = no floor).
   *  Completers are whale-pushed: at rq 12, topShare 0.4-0.6 completes 25%
   *  of the time vs 2% for 0-0.2. */
  minTopShare: number;
  // -- sizing --
  /** First buy of a position (SOL). */
  firstBuySol: number;
  /** Each add-on buy (SOL). */
  addBuySol: number;
  /** Most SOL at cost in one position. */
  stakeSol: number;
  /** Smallest buy worth sending. */
  minBuySol: number;
  /** Slippage on buys (bps); sells always go out wide open. */
  buySlipBps: number;
  // -- exits --
  /** Sell the whole position once its value reaches cost * (1 + takeProfit). */
  takeProfit: number;
  /** Sell once its value falls to cost * (1 - stopLoss). */
  stopLoss: number;
  /** Trailing stop from the position's best value, once armed. */
  trail: number;
  /** The trailing stop arms once value reached cost * (1 + trailArm). */
  trailArm: number;
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
  // -- adds --
  /** Add only once the price is this much above the last buy's decision price. */
  addStep: number;
  /** Add only while net SOL over the flow window is at least this. */
  addNetSol: number;
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
  window: 50,
  highWindow: 100,
  minAge: 0,
  maxAge: 30,
  minRealSol: 12,
  maxRealSol: 45,
  minBuyers: 1,
  maxBuyers: 8,
  minMult: 2.0,
  maxMult: 100,
  minNetSol: 0.5,
  minBuys: 1,
  minWindowBuyers: 1,
  nearHigh: 0.95,
  maxTopShare: 1.0,
  minTopShare: 0.4,
  firstBuySol: 0.15,
  addBuySol: 0.1,
  stakeSol: 0.15,
  minBuySol: 0.01,
  buySlipBps: 1500,
  takeProfit: 0.25,
  stopLoss: 0.25,
  trail: 0.2,
  trailArm: 0.3,
  maxHold: 600,
  staleSlots: 200,
  bigSellSol: 3,
  cooldown: 0,
  maxEntries: 1,
  addStep: 10,
  addNetSol: 0.1,
  maxMain: 5,
  targetCoins: 0,
  targetFills: 0,
  paceSecs: 14_400,
  probeSol: 0.01,
  maxProbes: 1,
  maxExposureSol: 6,
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
/** Trades are kept this many slots past the high window before pruning. */
const TRADE_KEEP_SLACK = 5;

interface Trade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
  price: number;
}

interface Coin {
  created: number | null;
  creator: string | null;
  creatorSold: boolean;
  /** Price at creation (virtual quote / virtual token reserves). */
  createPrice: number;
  /** Distinct non-creator buyers over the coin's whole life. */
  buyers: Set<string>;
  /** Slot of the most recent trade on this coin. */
  lastTradeSlot: number;
  trades: Trade[];
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  peakValue: number;
  /** SOL sent in buys for this position (fees included). */
  invested: number;
  exiting: boolean;
  filled: boolean;
  /** Recorded price when the last buy was decided. */
  lastAddPrice: number;
  /** Close value at the latest batch (SOL, curve and tx fees deducted). */
  lastValue: number;
}

/** Tape stats over the flow window, accumulated in trade order. */
interface WindowStats {
  buySol: number;
  sellSol: number;
  buys: number;
  high: number;
  last: number;
  /** Buy SOL per wallet inside the window. */
  byUser: Map<string, number>;
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
  const keep = p.highWindow + TRADE_KEEP_SLACK;

  const coinOf = (mint: Pubkey): Coin => {
    let c = coins.get(mint);
    if (c === undefined) {
      c = { created: null, creator: null, creatorSold: false, createPrice: 0, buyers: new Set(), lastTradeSlot: 0, trades: [], entries: 0, lastExit: NEVER_EXITED };
      coins.set(mint, c);
    }
    return c;
  };

  /** Net recorded SOL (buys minus sells) over the last `w` slots. */
  const flow = (c: Coin, now: number, w: number): number => {
    let net = 0;
    for (let i = c.trades.length - 1; i >= 0; i--) {
      const tr = c.trades[i]!;
      if (tr.slot <= now - w) break;
      net += tr.buy ? tr.sol : -tr.sol;
    }
    return net;
  };

  /** Accumulate the tape stats over the flow window ending at slot `now`. */
  const windowStats = (c: Coin, now: number): WindowStats => {
    const from = now - p.window;
    const stats: WindowStats = { buySol: 0, sellSol: 0, buys: 0, high: 0, last: 0, byUser: new Map() };
    for (const tr of c.trades) {
      if (tr.slot <= from) continue;
      if (tr.buy) {
        stats.buySol += tr.sol;
        stats.buys++;
        stats.byUser.set(tr.user, (stats.byUser.get(tr.user) ?? 0) + tr.sol);
      } else {
        stats.sellSol += tr.sol;
      }
      if (tr.price > stats.high) stats.high = tr.price;
      stats.last = tr.price;
    }
    return stats;
  };

  /** Highest trade price over the last `w` slots (0 when the coin never traded there). */
  const highOver = (c: Coin, now: number, w: number): number => {
    let high = 0;
    for (let i = c.trades.length - 1; i >= 0; i--) {
      const tr = c.trades[i]!;
      if (tr.slot <= now - w) break;
      if (tr.price > high) high = tr.price;
    }
    return high;
  };

  /** Late-strength entry signal on a coin's tape at slot `now`. */
  const entrySignal = (c: Coin, now: number, rqSol: number, price: number): boolean => {
    if (rqSol < p.minRealSol || rqSol > p.maxRealSol) return false;
    if (c.created === null || now - c.created < p.minAge || now - c.created > p.maxAge) return false;
    if (c.creatorSold) return false;
    if (c.createPrice <= 0) return false;
    const mult = price / c.createPrice;
    if (mult < p.minMult || mult > p.maxMult) return false;
    if (c.buyers.size < p.minBuyers) return false;
    if (p.maxBuyers > 0 && c.buyers.size > p.maxBuyers) return false;
    const s = windowStats(c, now);
    if (s.buys < p.minBuys || s.byUser.size < p.minWindowBuyers) return false;
    if (s.buySol - s.sellSol < p.minNetSol) return false;
    const high = highOver(c, now, p.highWindow);
    if (high > 0 && price < high * p.nearHigh) return false;
    let top = 0;
    for (const v of s.byUser.values()) if (v > top) top = v;
    if (top > p.maxTopShare * s.buySol) return false;
    if (p.minTopShare > 0 && s.buySol > 0 && top < p.minTopShare * s.buySol) return false;
    return true;
  };

  /** Close value of a position at the current marks (SOL, curve and tx fees deducted). */
  const positionValue = (tokens: number, vq: number, vt: number, tx: number): number =>
    ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;

  /** Take-profit: value reached cost * (1 + takeProfit). */
  const hitTakeProfit = (value: number, cost: number): boolean => value >= cost * (1 + p.takeProfit);
  /** Stop-loss: value fell to cost * (1 - stopLoss). */
  const hitStopLoss = (value: number, cost: number): boolean => value < cost * (1 - p.stopLoss);
  /** Trailing stop, armed once the peak reached cost * (1 + trailArm). */
  const hitTrailingStop = (h: Held, value: number, cost: number): boolean =>
    h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - p.trail);
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
    if (hitTrailingStop(h, value, cost)) return true;
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

  /** Drop trades older than the high window (plus slack) from a coin's tape. */
  const pruneTrades = (c: Coin, now: number): void => {
    let cut = 0;
    while (cut < c.trades.length && c.trades[cut]!.slot <= now - keep) cut++;
    if (cut > 0) c.trades.splice(0, cut);
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

  /** Size of an add-on buy for a held position, or null when no add is warranted. */
  const addAmount = (c: Coin, h: Held, mint: Pubkey, now: number, price: number, rqSol: number, state: BotState): number | null => {
    if (h.exiting || !h.filled || h.invested >= p.stakeSol - p.minBuySol) return null;
    if (state.positions.get(mint) === undefined) return null;
    if (price < h.lastAddPrice * (1 + p.addStep)) return null;
    if (flow(c, now, p.window) < p.addNetSol) return null;
    if (rqSol > p.maxRealSol) return null;
    return Math.min(p.addBuySol, p.stakeSol - h.invested);
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

      // --- intake: fold the batch's events into the per-coin tape ---
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
          c.trades.push({
            slot: e.slot,
            buy: e.is_buy,
            sol,
            user: e.user,
            price: Number(e.virtual_quote_reserves) / Number(e.virtual_token_reserves),
          });
          c.lastTradeSlot = e.slot;
          traded.add(e.mint);
          if (e.is_buy && e.user !== c.creator) c.buyers.add(e.user);
          if (!e.is_buy && sol >= p.bigSellSol) bigSell.add(e.mint);
          if (!e.is_buy && c.creator !== null && e.user === c.creator) c.creatorSold = true;
        }
      }

      // --- prune trades older than the high window (plus slack) ---
      for (const mint of traded) pruneTrades(coins.get(mint)!, now);

      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // --- phase 1: exits first ---
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
        const value = positionValue(Number(pos.token_amount), vq, vt, tx);
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        const c = coinOf(mint);
        if (!shouldExit(h, c, value, cost, now, bigSell.has(mint))) continue;
        h.exiting = true;
        if (pendingByMint.has(mint) && hasPendingSell(state, mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: SELL_SLIP_BPS });
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
          // Add into strength only: the price stepped up from the last add and flow is positive.
          const add = addAmount(c, h, mint, now, price, rqSol, state);
          if (add === null) continue;
          want = add;
        }
        const amount = sizeBuy(state, mint, want, free, exposure, tx);
        if (amount === null) continue;
        orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        exposure += amount;
        if (h === undefined) {
          held.set(mint, { opened: now, peakValue: 0, invested: amount, exiting: false, filled: false, lastAddPrice: price, lastValue: 0 });
          c.entries++;
          slotsLeft--;
          mainLeft--;
        } else {
          h.invested += amount;
          h.lastAddPrice = price;
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
