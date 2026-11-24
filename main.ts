// SPDX-License-Identifier: MIT
// pump-fun-replay-sprint v5: dip-recovery paper bot for the pump.fun replay
// (agent-fun/replay/v2). The grader runs `node /bot/main.ts`; the strategy lives in
// strategy.ts and the SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.
//
// v5 is the max build on v3's dip-recovery + scale-into-strength core: it
// buys dispersed-ownership coins (buyers >= 50, topShare <= 0.4) AFTER a
// >= 30% dip from peak, once the price retakes the old peak in full (rq 15-60,
// age >= 50, price >= 1.5x create), then scales into strength: +0.4 SOL adds
// each time rq climbs +3 above the last buy's rq, up to 3.0 SOL at cost per
// coin, with no more adds once a position's value exceeds 2x its cost. New in
// v5: a momentum sleeve (dip 15% + full recovery, rq >= 35, 0.10 SOL first
// buy, 0.30 stake, max 2) for the momentum-only completers; selective
// creator-sold entries (rq >= 35, 0.15 SOL first buy, no adds until >1.5x
// cost); a whale-sell exit threshold of 6 SOL (v3's 5 SOL cut a completer on
// a single 5.893 SOL sell); and a 0.35 trailing stop. No take-profit — it
// rides to completion (plus stale 600, max hold 4000, creator-sold and
// >= 6 SOL whale-sell exits), selling in chunks so no sale exceeds half the
// curve's real reserves. Guardrail probes ON (target 25 coins / 60 fills).
// Tuned on the FULL dev window via tools/backtest-full.ts: full backtest net
// +6.249416 SOL, 173 fills, 59 coins, 65 trips, 10 wins, max drawdown 12.0%,
// 2x fees +5.632 — vs v3's +3.030 SOL. 5 of 7 slow completers caught (v3: 2).
// See STRATEGY-v5.md for the full reasoning and the honest caveats.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
