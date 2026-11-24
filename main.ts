// SPDX-License-Identifier: MIT
// pump-fun-replay-sprint: early-momentum paper bot for the pump.fun replay
// (agent-fun/replay/v2). The grader runs `node /bot/main.ts`; the strategy lives in
// strategy.ts and the SDK shim is the kit's sdk/ts/makefun-bot.ts, vendored byte for byte.
//
// Tuned on the dev window via the kit's local sim (28 configs swept, flat region picked):
// takeProfit 0.2, stopLoss 0.08, trail 0.15, maxAge 300. Backtest: net -0.141665 SOL,
// 472 fills, 144 coins, 200 trips, 25 wins, max drawdown 1.7%. grade-local (process
// driver, no docker on this VM): dev net -1.037057 SOL, guardrails met, L1 regrade
// reproduced byte for byte; the local sim is kinder than the real harness, so the
// grade-local number is the honest one. Stress (20 copies): median -0.64, all 20 lost
// money — the final window is unseen, so this bot is a lose-less entry, not a winner.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
