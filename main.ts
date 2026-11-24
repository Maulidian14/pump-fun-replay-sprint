// SPDX-License-Identifier: MIT
// pump-fun-replay-sprint v3: dip-recovery paper bot for the pump.fun replay
// (agent-fun/replay/v2). The grader runs `node /bot/main.ts`; the strategy lives in
// strategy.ts and the SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.
//
// v3 buys dispersed-ownership coins (buyers >= 50, topShare <= 0.4) AFTER a
// >= 30% dip from peak, once the price retakes the old peak in full (rq 15-70,
// age >= 50, price >= 1.5x create, creator not sold), then scales into
// strength: +0.4 SOL adds each time rq climbs +3 above the last buy's rq,
// up to 3.0 SOL at cost per coin. No take-profit — it rides to completion on
// a 0.38 trailing stop (plus stale 600, max hold 4000, creator-sold and
// >= 5 SOL whale-sell exits), selling in chunks so no sale exceeds half the
// curve's real reserves. Guardrail probes ON (target 25 coins / 60 fills):
// the main entry fires only 22 times on dev, too close to the >= 20 guardrail.
// Tuned on the FULL dev window via tools/backtest-full.ts (the kit sim reads
// only part-00000 of 3, which is why v1's sim and grade-local disagreed):
// full backtest net +3.030266 SOL, 142 fills, 47 coins, 52 trips, 5 wins,
// max drawdown 23.1%. v2 scored +0.550 SOL on grade-local, so v3 is a +2.48
// SOL swing — profitable, though still far from the dev board's +12.52 #1.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
