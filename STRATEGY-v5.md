# Pump.fun Replay Sprint v5 — Catch More Completers, Lose the Disaster

v3 (dip-recovery + scale-into-strength) scores **+3.021 SOL on grade-local**
(~#5-6 of 351 on the dev board). Its whole edge is 2 of the 7 tradeable
slow completers: 98% of its gains come from its top 3 coins, and its worst
trip (-1.207 SOL) is a coin that rose enough to earn full adds, then dumped
through the 0.38 trail. v5 is the max build: every lever below was verified
in `tools/backtest-full.ts` (full dev window, all 3 parts, 128,058 events,
1,222 mints) and kept only if it helps. All numbers in this file are the
full-window backtest unless marked grade-local.

## The five levers that ship

**1. Whale-sell threshold 5 -> 6 SOL (+1.29 SOL alone).** The v3 safety
"exit on any single sell >= 5 SOL" cut the 3rd completer, 6MVWPQwr2Y, on
one 5.893 SOL sell 54 slots after entry — verified in the raw tape (slot
464581643, seller FDMUSTTNNkFs). The coin went on to complete. Raising the
threshold to 6 saves it (+1.338 in v5) and still catches a 6.5-7 SOL dump
elsewhere: 6.0-6.5 is a flat plateau (+5.97-5.99 with the sleeves at trail
0.38), 5.5 is a cliff (+4.59, the completer dies again), 7-8 slightly
worse (+5.81). Disabling the exit entirely is worse (+4.92) — the safety
has real value, it was just set one SOL too tight.

**2. Momentum sleeve: dip 15% + full recovery, rq >= 35, first buy 0.10
SOL, stake 0.30, max 2 concurrent.** v3's 30% dip trigger can never see
the momentum-only completers (52frC8om59 and CHjgAurRkf never dip 30%;
max dips 20%/24%). The sleeve catches CHjgAurRkf (+0.299) and — because
maxEntries is shared per coin — pre-empts 9JvXQrnYmo early, entering it
small via the 15% dip and exiting +0.092 instead of riding it to -1.207.
Sweep: dip 0.15 (+4.527 alone) beats 0.20 (+4.146) and 0.25 (+4.150);
stake 0.30 beats 0.50-1.00 (bigger mom stakes lose money). 52frC8om59 is
still not caught (its recovery never satisfies the rq/buyer filters).

**3. Selective creator-sold entries: rq >= 35, first buy 0.15 SOL, no adds
until the position is up >1.5x cost.** v3's absolute creator-sold filter
costs 2 completers (Hhcck7SDvK 2.5x, GV3Nh35Rrp 1.65x). v5 buys them as a
cheap option: Hhcck7SDvK pays +0.558, GV3Nh35Rrp breakeven (+0.000). Sweep:
rq >= 35 (+4.496 alone) beats 25 (+3.980, too many losers) and 45 (+4.081,
misses a completer). Note the exit rule change: a selective creator-sold
entry already priced the creator's sale in, so the creator-sold exit does
not fire on it — only a FRESH creator sale after entry exits.

**4. Entry rq cap 70 -> 60 (flat region 55-65, all +4.237).** The rq 65-70
band holds exactly one dev entry and it is the -1.207 SOL disaster.
Excluding the band costs nothing else: both completers enter below rq 60.

**5. Trail 0.38 -> 0.35 (flat plateau 0.34-0.36 at +6.21-6.24) and an add
cap: no adds once a position's value exceeds 2x its cost.** The add cap
stops capital piling into a single coin at the top (+0.021 alone, kept for
robustness). Trail 0.33 is a cliff (+4.94), 0.30 worse (+2.27) — the
plateau's midpoint 0.35 is the principled pick.

## Tested and REJECTED by the data

- **Two-stage trail (wide 0.45-0.50 early, tight 0.25-0.30 after 1.5x).**
  The original v5 hypothesis: the wide phase would save 6MVWPQwr2Y from
  its >38% mid-ride dips. Wrong diagnosis — the coin was cut by the
  whale-sell exit, not the trail (at trail 0.70 it still exits -0.060 in
  54 slots). Once bigSellSol is 6, the two-stage trail changes nothing
  (0.35/0.25 and 0.35/0.30 are byte-identical to single-stage 0.35 on
  dev), and the 0.45 wide phase actively hurts with the sleeves on
  (-0.18). The mechanism stays in code with trailTight == trail.
- **stakeSol below 3.0** (1.5 -> +2.05, 2.0 -> +2.57, 2.5 -> +2.97): caps
  cut the completers' payoff directly. The add cap (lever 5) is the
  cheaper way to limit concentration.
- **Disabling the whale-sell exit** (+4.92 vs +5.53 at threshold 8).
- **addRqStep other than 3** (2 -> +2.97, 4 -> +2.31, 5 -> +2.48);
  **addSol other than 0.4** (0.25 -> +2.56, 0.5 -> +3.01, 0.6 -> +2.82);
  **firstBuySol other than 0.15** (0.10/0.20 within noise at +3.06);
  **minBuyersDisp other than 50** (40 -> +2.87, 60 -> +2.77);
  **minRqEntry other than 15** (10 -> +2.53, 25 -> +2.12).

## Final numbers (backtest-full, all 3 parts)

- **net +6.249 SOL, 173 fills, 59 coins, 65 trips, 10 wins, dd 0.120.**
  Without failed txs +6.250; at 2x fees +5.632. Rejected 3, failed 2.
- Winners: AVGnvQCtRc (completer) **+4.555**, 6MVWPQwr2Y (completer)
  **+1.338**, C5Wm8Y9tVb (completer) **+1.000**, Hhcck7SDvK (completer)
  **+0.558**, CHjgAurRkf (completer) **+0.299**, 2x1DaQuT12 +0.207,
  92Zt8E5bx +0.110, J4nMyqq3NSym +0.034, 9JvXQrnYmo +0.034, GV3Nh35Rrp
  +0.000. Worst loss: DKANq8n2m -0.316 (v3's worst was -1.207).
- **5 of 7 slow completers caught** (v3 caught 2); a 6th (GV3Nh35Rrp)
  entered and exited flat. Only 52frC8om59 is missed entirely.

## Concentration — improved a lot, still concentrated (honest)

| Metric | v3 | v5 |
|---|---|---|
| Top coin's share of gross gains | 77.0% | 56.0% |
| Top 3 share of gross gains | 97.6% | 84.7% |
| Net without top 3 | -2.712 | -0.644 |
| Worst single loss | -1.207 | -0.316 |
| Winning trips | 5 | 10 |
| Completers caught | 2 of 7 | 5 of 7 |

The "no single coin >25% of gains" aspiration is NOT met and cannot be
met on this window by any strategy that beats v3: the payoff structure is
dominated by the single biggest completer (AVGnvQCtRc pays 11.6x from dip
prices), and only 7 slow completers exist in dev. Capping the winner down
to 25% would require either ~18 SOL of gross gains (impossible with 7
completers) or deliberately shrinking the best trade until the net falls
below v3's. v5 moves every concentration metric sharply in the right
direction instead, and the stress test (below) is the direct robustness
check.

## Numbers to beat (grade-local, process driver)

- v1: -1.037 SOL. v2: +0.550 SOL. v3: +3.021 SOL.
- Dev board #1: +12.52 SOL (quick-gecko-13-1579); #2: +4.00; #5: +3.25.
  v5's backtest +6.249 would sit between #1 and #2 on the dev board if
  grade-local tracks the backtest as it did for v3 (within ~0.05 SOL).

## Stress comparison vs v3 (grade-local --stress, 20 block surrogates)

| | v3 | v5 |
|---|---|---|
| Dev grade-local net | +3.021 | +5.969 |
| Stress median | -0.90 | -1.37 |
| Stress p10 | -1.86 | -2.15 |
| Stress p90 | -0.07 | -0.18 |
| Copies losing money | 18/20 | 19/20 |

v5's stress median/p10 are WORSE than v3's: v5 makes more trades (65 vs 52
trips), and in rebuilt windows — where the completer sequences are shuffled
apart — the extra momentum/creator-sold trades mostly lose without the
completer payoff. Both versions draw the same two warnings (dev score above
90% of copies; half or more copies lost money). The trade: v5's dev net is
+2.95 SOL better and its 90% interval (-0.35..+15.42) far better than v3's
(-3.52..+13.15), against ~0.5 SOL worse downside in the no-completer
scenario. The final window is a real window with real completers, not a
block-shuffled surrogate — v5 is the better entry for it, but the stress
result is the honest caveat.

## Honest caveat

The tradeable-completer sample is 7 coins, and v5's two biggest wins from
new levers each turn on a single event: the 5.893 SOL sell (bigSellSol 6)
and the rq 65-70 band (maxRqEntry 60). Both are flat regions, not
knife-edges, and the sleeves add genuinely new winners (CHjgAurRkf,
Hhcck7SDvK) rather than re-cutting the same 2 coins — but the final window
is unseen data, and no dev number guarantees anything. The stress test is
the check that matters: see the grade-local --stress line in the commit
message / submission report.
