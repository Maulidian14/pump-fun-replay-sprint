# Pump.fun Replay Sprint v2 — Catch the Whale Pump, Bank +25%, Get Out

v1 (early-momentum, commit d809b16d) scored **−1.037 SOL on grade-local**.
v2 scores **+0.550 SOL on grade-local** (98 fills, 49 coins, 49 trips, 49%
win rate, max drawdown 2.8%, guardrails met) — a +1.59 SOL swing. It is
profitable, but still far from #1 (+3.76 SOL); the winners' edge is a
strategy family this build did not find.

## The two discoveries that changed everything

**1. The kit sim only reads part-00000.** The dataset has three parts
(128,058 events, 1,222 mints); the kit sim's `loadDataset` reads only the
first (50,000 events, 430 mints, the first ~46% of the window). That is why
v1's sim (−0.14 SOL, 144 coins) and its grade-local (−1.04 SOL, 367 coins)
disagreed so much. All v2 tuning used `tools/backtest-full.ts`, which loads
all three parts; it tracks grade-local within ~0.05 SOL (v2: backtest +0.600
vs grade-local +0.550).

**2. The first v2 thesis was backwards.** The dev-board winners' titles
("late-curve runner", "wait-for-strength", "wallet-farm filter") suggested
late, broad, organic entries. The full-window data says the opposite. At
rq 12 crossing (300 coins, 35 complete):

| Bucket | Completion rate |
| --- | --- |
| 0–5 buyers | 28% |
| 40+ buyers | 0% |
| topShare 0.4–0.6 | 25% |
| topShare 0–0.2 | 2% |
| age 0–20 slots | 16% |
| age 60+ slots | 0% |

Completers are fast, whale-driven coins: median age 0 slots at rq 12, 4
buyers, topShare 0.44. The "broad organic" coins (many buyers, low top
share, slow) never complete. The first v2 build (late-strength, buyers ≥ 25,
topShare ≤ 0.3) scored **−2.18 SOL on the full window** — worse than v1 —
because its filters excluded exactly the coins that move.

## What v2 does

**Entry — whale pumps only** (50 coins qualify over the window): age 0–30
slots, real SOL 12–45, 1–8 lifetime buyers, price ≥ 2x create price, window
top share ≥ 0.4, price within 5% of its 100-slot high, positive net flow.
Only 1 of the 50 completes, so the edge is NOT completion — it is that whale
pumps reliably run a further +25–30% before dumping, and the take-profit
banks it.

**Exits — tight and asymmetric:** take profit +25% (the flat peak of the TP
curve: 0.25 and 0.30 both give +0.14 on the strict filter; 0.5 gives +0.05,
1.0 gives +0.01), stop loss −25% (a 15% stop cuts winners mid-dip), exit on
any single ≥ 3 SOL sell (the whale leaving — disabling this costs 0.3 SOL),
stale after 200 slots, max hold 600. The trailing stop never fires on this
config.

**Sizing — one 0.15 SOL buy per coin, no adds.** The 1% of real reserve
order cap clips it to ~0.12 SOL at rq 12 anyway; bigger size loses more
(0.25 stake: −0.07 vs +0.01 at 0.15) and pyramiding hurts (adds: −0.02 vs
+0.01). The cap is enforced per batch across all orders on a mint, so
multiple same-batch orders cannot build a bigger position.

**Guardrail probes OFF** (targetCoins/targetFills 0): the 50 main entries
clear the ≥ 20 coin guardrail on their own, and the probes were a −0.07 SOL
drag that also stole position slots.

## What was tested and rejected (full-window numbers)

- Late-strength v2 (buyers ≥ 25, topShare ≤ 0.3, TP 1.0): −2.18 SOL.
- Completion rider (enter rq ≥ 15, pyramid adds, ride to completion): −2.70
  SOL on part-00000 alone — gap-downs blow through stops, sells get stuck
  (max_order_size rejections: 282–1007), adds concentrate cost at the top.
- Reversion pilot (kit): −4.02 SOL on the full window, despite the kit
  comment claiming a "broadly profitable region" (tuned on part-00000 only).
- Momentum pilot (kit): −9.39 SOL (blows up the account, dd 95%).
- #7-style early-flow sniper (0.5 SOL, TP/SL ±15%): −0.70 SOL.
- Entering later (rq 18–20+, bigger size): −0.15 to −0.19 SOL, 5–7 coins —
  by rq 20 the pump is mostly over.
- Loosening the filter (rq 5, age 60, buyers ≤ 10, mult 1.5, topShare 0.3):
  −1.40 SOL, 277 coins. The filter IS the edge; every loosening loses.
- TP curve is a flat peak at 0.25–0.30 (+0.14 on the strict filter);
  SL 0.20–0.30 is flat-positive (+0.45 to +0.52); bigSell 3–4 SOL flat
  (+0.52–0.53). The final config sits in the middle of a flat region, not
  on a spike.

## Final numbers (grade-local, process driver, worktree)

- Net PnL **+0.550 SOL** (return +5.5%; 90% interval −0.09 to +1.17 SOL)
- 98 fills, 49 coins, 49 round trips, win rate 49%, max drawdown 2.8%
- Fees 0.180 SOL curve + 0.011 SOL tx; at 2x fees net +0.355 SOL
- Top 3 coins made 31% of gains; without them net is still +0.15 SOL
- Guardrails met (49 coins ≥ 20, drawdown ≤ 50%)

## Honest caveat

+0.55 SOL would rank around #11–12 on the dev board (#10 is +0.72, #1 is
+3.76). The winners trade 93–440 fills with a per-trade edge this build did
not reproduce — possibly a completion-riding filter that catches the 35
completers without the gap-down/stuck-sell losses, or a much larger trade
count at a small positive expectancy. The final window is unseen data, so no
dev number guarantees anything.
