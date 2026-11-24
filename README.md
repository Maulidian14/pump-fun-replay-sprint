# Pump.fun Replay Sprint — Paper Bot

A fast whale-pump paper trading bot for the [Pump.fun Replay Sprint](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) bounty on make.fun. It trades 10 SOL of paper money on a 24h replay of pump.fun bonding-curve activity. Best net PnL wins. v2 scores **+0.550 SOL on grade-local** (v1: −1.037 SOL).

[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Maulidian14/pump-fun-replay-sprint/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Maulidian14/pump-fun-replay-sprint/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

## Strategy

- **Whale pumps only** (age 0–30 slots): real SOL 12–45, 1–8 lifetime buyers, price ≥ 2x create price, largest wallet ≥ 40% of recent buy SOL, price within 5% of its 100-slot high. On this tape the coins that move are fast and whale-driven — broad, slow, "organic" coins never complete (see `STRATEGY-v2.md`).
- **One 0.15 SOL buy per coin, no adds**: the 1% of real reserve order cap clips it to ~0.12 SOL at rq 12 anyway, and pyramiding loses money here.
- **Bank the pump, dodge the dump**: take profit at +25%, stop loss at −25%, exit on any single ≥ 3 SOL sell (the whale leaving), stale after 200 slots, max hold 600 slots.
- **Guardrail probes off**: the 50 main entries clear the ≥ 20 coin guardrail on their own.

Fully deterministic: no clock, no environment, no randomness — the two graded executions produce identical action logs.

## Layout

- `main.ts` — entrypoint the grader runs (`node /bot/main.ts`).
- `strategy.ts` — the bot.
- `STRATEGY-v2.md` — the full design rationale, what was tested and rejected, and the final numbers.
- `vendor/makefun-bot.ts` — the kit's SDK shim, vendored byte for byte.
- `tools/backtest.ts` — offline backtest on the kit's dev window (dev tooling only; reads only part-00000 of the dataset).
- `tools/backtest-full.ts` — offline backtest on the FULL dev window (all 3 dataset parts); this is the one that tracks grade-local.
