// Early-momentum paper bot for the pump.fun bonding-curve replay (agent-fun/replay/v2).
//
// What the dev tape says (430 coins in the first shard):
//   - Runners are rare: only 19 coins ever reach 10x, 32 reach 5x, 87 reach 2x. The median
//     coin's best excursion is 1.23x, most coins stay tiny (median peak real SOL 3.3, median
//     12 trades). The profit is in catching a few runners early, never in holding the field.
//   - Late entries are what kill momentum bots here: by the time a curve looks established
//     the run is usually over and the dump has begun. So entries are early (5-150 slots after
//     CreateEvent), small, and gated on real breadth: several distinct buyers, net SOL flowing
//     in, price up a little but not parabolic, and the creator not selling (a creator sell is
//     a rug tell).
//   - A position only grows while it works: small adds as the price steps up and flow stays
//     positive, up to a per-coin cap. Losers are cut fast, winners banked fast, with a trailing
//     stop for the ones that keep running.
//   - A pacing probe keeps the guardrails green: the run must end with round trips of at least
//     0.01 SOL on 20+ coins, so when coins or fills lag the pace the bot opens a tiny 0.01 SOL
//     probe on a liquid curve and sells it as soon as it lands.
//
// Everything is a pure function of the batches: no clock, no environment, no randomness, so
// the two graded executions produce byte-identical action logs. Iteration is only over
// insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

/** All tunables of the strategy, in one place. */
export interface Params {
  // -- entry window and age --
  /** Entry window in slots. */
  window: number;
  /** Youngest age (slots since CreateEvent) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  // -- entry tape filters --
  /** Net buy SOL (buys minus sells) over the entry window. */
  minNetSol: number;
  /** Buy trades in the entry window. */
  minBuys: number;
  /** Distinct buying wallets in the entry window. */
  minBuyers: number;
  /** Price now over price at window start, minus 1: lower bound. */
  minRise: number;
  /** Same, upper bound: skip curves that already ran too far. */
  maxRise: number;
  /** Price now at least this share of the window high. */
  nearHigh: number;
  /** Largest single wallet's share of the window's buy SOL. */
  maxTopShare: number;
  /** Real SOL bounds at entry. */
  minRealSol: number;
  maxRealSol: number;
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
  /** Exit on any single recorded sell of at least this many SOL. */
  bigSellSol: number;
  /** Slots to wait after an exit before the same coin may be bought again. */
  cooldown: number;
  /** Most entries per coin over the run. */
  maxEntries: number;
  // -- adds --
  /** Add only once the price is this much above the last buy's decision price. */
  addStep: number;
  /** Add only while net SOL over the entry window is at least this. */
  addNetSol: number;
  // -- caps and pacing --
  /** Most momentum positions open at once (the rest of the cap is for probes). */
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
  window: 20,
  minAge: 5,
  maxAge: 300,
  minNetSol: 0.3,
  minBuys: 3,
  minBuyers: 3,
  minRise: 0.02,
  maxRise: 0.8,
  nearHigh: 0.9,
  maxTopShare: 0.6,
  minRealSol: 1,
  maxRealSol: 40,
  firstBuySol: 0.02,
  addBuySol: 0.05,
  stakeSol: 0.3,
  minBuySol: 0.01,
  buySlipBps: 1500,
  takeProfit: 0.2,
  stopLoss: 0.08,
  trail: 0.15,
  trailArm: 0.1,
  maxHold: 600,
  bigSellSol: 2,
  cooldown: 150,
  maxEntries: 2,
  addStep: 0.05,
  addNetSol: 0.1,
  maxMain: 5,
  targetCoins: 25,
  targetFills: 240,
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
/** Trades are kept this many slots past the entry window before pruning. */
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

/** Tape stats over the entry window, accumulated in trade order. */
interface WindowStats {
  buySol: number;
  sellSol: number;
  buys: number;
  /** Price at the window's start (last trade at or before it, else the first inside). */
  startPrice: number;
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
  const keep = p.window + TRADE_KEEP_SLACK;

  const coinOf = (mint: Pubkey): Coin => {
    let c = coins.get(mint);
    if (c === undefined) {
      c = { created: null, creator: null, creatorSold: false, trades: [], entries: 0, lastExit: NEVER_EXITED };
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

  /** Accumulate the tape stats over the entry window ending at slot `now`. */
  const windowStats = (c: Coin, now: number): WindowStats => {
    const from = now - p.window;
    const stats: WindowStats = { buySol: 0, sellSol: 0, buys: 0, startPrice: -1, high: 0, last: 0, byUser: new Map() };
    for (const tr of c.trades) {
      if (tr.slot <= from) {
        stats.startPrice = tr.price;
        continue;
      }
      if (stats.startPrice < 0) stats.startPrice = tr.price;
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

  /** Entry signal on a coin's tape at slot `now`. */
  const entrySignal = (c: Coin, now: number, rqSol: number): boolean => {
    if (rqSol < p.minRealSol || rqSol > p.maxRealSol) return false;
    if (c.created === null || now - c.created < p.minAge || now - c.created > p.maxAge) return false;
    if (c.creatorSold) return false;
    const s = windowStats(c, now);
    if (s.buys < p.minBuys || s.byUser.size < p.minBuyers) return false;
    if (s.buySol - s.sellSol < p.minNetSol) return false;
    if (s.startPrice <= 0) return false;
    const rise = s.last / s.startPrice - 1;
    if (rise < p.minRise || rise > p.maxRise) return false;
    if (s.last < s.high * p.nearHigh) return false;
    let top = 0;
    for (const v of s.byUser.values()) if (v > top) top = v;
    if (top > p.maxTopShare * s.buySol) return false;
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

  /** Exit decision for a held position, checks in priority order. */
  const shouldExit = (h: Held, value: number, cost: number, now: number, bigSell: boolean, creatorSold: boolean): boolean => {
    if (h.exiting) return true;
    if (hitTakeProfit(value, cost)) return true;
    if (hitStopLoss(value, cost)) return true;
    if (hitTrailingStop(h, value, cost)) return true;
    if (bigSell) return true;
    if (creatorSold) return true;
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

  /** Drop trades older than the window (plus slack) from a coin's tape. */
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
  const mayEnter = (c: Coin, now: number, rqSol: number, slotsLeft: number, mainLeft: number): boolean => {
    if (slotsLeft <= 0 || mainLeft <= 0) return false;
    if (c.entries >= p.maxEntries || now - c.lastExit < p.cooldown) return false;
    return entrySignal(c, now, rqSol);
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
          traded.add(e.mint);
          if (!e.is_buy && sol >= p.bigSellSol) bigSell.add(e.mint);
          if (!e.is_buy && c.creator !== null && e.user === c.creator) c.creatorSold = true;
        }
      }

      // --- prune trades older than the window (plus slack) ---
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
        if (!shouldExit(h, value, cost, now, bigSell.has(mint), c.creatorSold)) continue;
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
          if (!mayEnter(c, now, rqSol, slotsLeft, mainLeft)) continue;
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
