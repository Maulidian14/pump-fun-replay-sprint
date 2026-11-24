// SPDX-License-Identifier: MIT
// pump-fun-replay-sprint v2: fast whale-pump paper bot for the pump.fun replay
// (agent-fun/replay/v2). The grader runs `node /bot/main.ts`; the strategy lives in
// strategy.ts and the SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.
//
// v2 catches whale pumps (age 0-30, rq 12-45, 1-8 buyers, topShare >= 0.4,
// price >= 2x create, within 5% of its high), banks +25% take profit, and exits
// on a -25% stop, a >= 3 SOL whale sell, or 200 stale slots; one 0.15 SOL buy
// per coin, no adds, guardrail probes off. Tuned on the FULL dev window via
// tools/backtest-full.ts (the kit sim reads only part-00000 of 3, which is why
// v1's sim and grade-local disagreed): full backtest net +0.600138 SOL, 100
// fills, 50 coins, 50 trips, 25 wins, max drawdown 2.8%. grade-local (process
// driver, no docker on this VM): dev net +0.550037 SOL, 98 fills, 49 coins,
// 49 trips, win rate 49%, max drawdown 2.8%, guardrails met, L1 regrade
// reproduced byte for byte. v1 scored -1.037057 SOL on grade-local, so v2 is a
// +1.59 SOL swing — profitable, though still far from the dev board's +3.76 #1.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
