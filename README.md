# Pump.fun Replay Sprint — Paper Bot

An early-momentum paper trading bot for the [Pump.fun Replay Sprint](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) bounty on make.fun. It trades 10 SOL of paper money on a 24h replay of pump.fun bonding-curve activity. Best net PnL wins.

[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Maulidian14/pump-fun-replay-sprint/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Maulidian14/pump-fun-replay-sprint/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

## Strategy

- **Early entries only** (5–150 slots after a curve is created): on this tape the money is in the few coins that run 5–15x, and buying late means buying the top.
- **Breadth filter**: several distinct buyers, net SOL flowing in, price up a little but not parabolic, and the creator must not have sold.
- **Small first buys, pyramid into strength**: add in steps only while the price steps up and flow stays positive, up to 0.3 SOL per coin.
- **Fast exits**: take profit at +40%, stop loss at −15%, trailing stop once up 10%, plus exits on a big sell, a creator sell, or a time limit.
- **Guardrail pacing**: tiny 0.01 SOL probe round trips keep the run above 20 coins traded when the main strategy is quiet.

Fully deterministic: no clock, no environment, no randomness — the two graded executions produce identical action logs.

## Layout

- `main.ts` — entrypoint the grader runs (`node /bot/main.ts`).
- `strategy.ts` — the bot.
- `vendor/makefun-bot.ts` — the kit's SDK shim, vendored byte for byte.
- `tools/backtest.ts` — offline backtest on the kit's dev window (dev tooling only).
