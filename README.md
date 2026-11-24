# Pump.fun Replay Sprint — Paper Bot

A dip-recovery paper trading bot for the [Pump.fun Replay Sprint](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) bounty on make.fun. It trades 10 SOL of paper money on a 24h replay of pump.fun bonding-curve activity. Best net PnL wins. v5 scores **+5.969 SOL on grade-local** (v3: +3.021, v2: +0.550, v1: −1.037 SOL).

[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Maulidian14/pump-fun-replay-sprint/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Maulidian14/pump-fun-replay-sprint/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

## Strategy

- **Buy the exhaustion, ride the dispersed coins to completion**: enter dispersed-ownership coins (buyers ≥ 50, topShare ≤ 0.4) AFTER a ≥ 30% dip from peak, once the price retakes the old peak in full (rq 15–60, age ≥ 50 slots, price ≥ 1.5x create). A dip-recovery on a dispersed coin completes 17% of the time (see `STRATEGY-v5.md`).
- **Scale into strength**: +0.4 SOL adds each time rq climbs +3 above the last buy's rq, up to 3.0 SOL at cost per coin — losers stall early and stay small, winners keep earning adds. No more adds once a position's value exceeds 2x its cost.
- **Momentum sleeve**: a second, capped trigger (dip 15% + full recovery, rq ≥ 35, 0.10 SOL first buy, 0.30 stake, max 2) for the momentum-only completers the 30% dip trigger can never see.
- **Selective creator-sold entries** (rq ≥ 35, 0.15 SOL first buy, no adds until >1.5x cost): a cheap option on the creator-sold completers the absolute filter excluded.
- **Ride to completion, no take-profit**: 0.35 trailing stop, stale after 600 slots, max hold 4,000 slots, exit on creator-sold or any single ≥ 6 SOL sell. Sells are chunked so no sale exceeds half the curve's real reserves.
- **Guardrail probes ON** (target 25 coins / 60 fills): the main entries alone sit too close to the ≥ 20 coin guardrail for an unseen final window.

Fully deterministic: no clock, no environment, no randomness — the two graded executions produce byte-identical action logs (L1 regrade reproduced byte for byte).

## Layout

- `main.ts` — entrypoint the grader runs (`node /bot/main.ts`).
- `strategy.ts` — the bot.
- `STRATEGY-v5.md` — the full design rationale, what was tested and rejected, and the final numbers.
- `STRATEGY-v3.md`, `STRATEGY-v2.md` — earlier versions' rationale.
- `vendor/makefun-bot.ts` — the kit's SDK shim, vendored byte for byte.
- `tools/backtest.ts` — offline backtest on the kit's dev window (dev tooling only; reads only part-00000 of the dataset).
- `tools/backtest-full.ts` — offline backtest on the FULL dev window (all 3 dataset parts); this is the one that tracks grade-local.
