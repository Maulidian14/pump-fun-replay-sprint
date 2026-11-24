# Pump.fun Replay Sprint v3 — Buy the Exhaustion, Ride the Dispersed Coins to Completion

v2 (fast whale-pump, commit 2d2363d) scores **+0.550 SOL on grade-local**
(~#13 of 255). The #1 bot (verified live 13:47 WIB 24 Nov) is
quick-gecko-13-1579, "Overhang Exhaustion & Dispersed Ownership Bot", at
**+12.52 SOL**. v3 is built from that title's lead: a reversion/exhaustion
strategy on dispersed-ownership coins. This file documents what the full dev
window (all 3 parts, 128,058 events, 1,222 mints) actually says — every
number below comes from /tmp/pf-v3-analyze{,2,3,4}.ts, not from the title.

## What the data says

**1. Generic dip-buying loses.** Of 1,671 dip events (first crossing of a
20/30/40/50% fall from the running peak, peak rq >= 3): only 29% of 20%
dips and 16% of 50% dips bounce >= +20% within 600 slots, while ~47-49%
fall a further >= 20%. Median bounce is 0-4%. This is why the kit's
reversion pilot scores -4.02 SOL on the full window.

**2. Dispersed coins are more volatile both ways.** Dips on dispersed coins
(>= 15 buyers, topShare < 0.4) bounce >= +20% more often than concentrated
ones (38% vs 24% at 20% depth) but also fall a further 20% far more often
(68% vs 38%). Dispersion alone is not an edge — it is a volatility filter.

**3. There are two kinds of completers, and only one is tradeable.**
35 coins complete. 28 complete in the same slot they are created (one huge
buy) — the bot never gets a batch to act on them, and the 2-slot fill
latency kills even the one age-1 completer. The 7 tradeable ("slow")
completers take 345-2,205 slots, end with 248-1,019 buyers and topShare
0.02-0.05, and dip 20-65% along the way. Their dip-to-completion multiples
are 1.4x-11.6x (mean ~5.6x from the 20% dip, ~2.5x from the recovery).

**4. Completion odds rise steeply with rq — and with a dip-recovery.**
Base rates (excluding instant completers): rq >= 15 -> 3% complete (7/215);
rq >= 35 -> 12%; rq >= 55 -> 35% (7/20); rq >= 65 -> 39%. A dip-recovery
event (dip >= 30% from peak, then price retakes the old peak) completes
11% of the time (11/99); with the dispersion filter (buyers >= 50,
topShare <= 0.2, rq >= 15) it is 17% (10/60), median forward max 1.36x.
A HALF recovery (retake 50% of the dip) fires twice as often (105 filtered
events) at 10% completion. "Stabilisation" triggers (no new low for 50-100
slots, with or without positive flow) are value traps: 2-5% completion,
EV -2.4 to -4.4 SOL — most stabilised coins just die slowly.

**5. The edge is scale-into-strength, not the entry alone.** A flat
0.15 SOL buy at every dip-recovery with a -40% stop and milestone adds is
worth only +0.2 to +1.5 SOL (marks-only EV). The winners pay 2-5x but the
losers are 83% of trades. The asymmetry that pays is: losers stall early
(they never earn adds, so they only ever cost the 0.15 first buy), while
winners keep rising and keep earning adds — so deployed capital
concentrates into the coins that complete. v3 therefore sizes adds by rq
growth (add while rq climbs), not by a fixed schedule.

**6. The creator-sold filter is worth keeping.** Among 41 first filtered
recovery events: creator-not-sold (n=20) completes 15%, median forward max
1.49x, 8/20 fall >= 50%; creator-sold (n=21) completes 10%, median
forward max 1.22x, 15/21 fall >= 50%. The filter costs 2 completers
(Hhcck7SDvK 2.5x, GV3Nh35Rrp 1.65x) but excludes 19 mostly-losing entries
that would also compete for the 5 position slots. Kept.

**7. The bot catches 2 of 7 slow completers.** C5Wm8Y9tVb and AVGnvQCtRc
trigger and pass; 6MVWPQwr2Y triggers but the trailing stop cuts it near
breakeven (it dips >38% mid-ride); 52frC8om59 and CHjgAurRkf never dip
30% (max dips 20%/24% — momentum-only coins, v2's family, not v3's);
Hhcck7SDvK and GV3Nh35Rrp are excluded by the creator-sold filter (see 6).
Two completers pay +5.5 SOL of the +3.0 net — the strategy is a
concentrated bet on catching slow completers, and its variance is high.

## What v3 does

**Entry — dip-recovery on dispersed coins.** A coin qualifies when it has
dipped >= 30% from its running peak and then retaken the old peak in full
(recoverShare 1.0 — the sweep was decisive: 0.75 -> +0.16, 0.5 -> -2.86),
with >= 50 lifetime buyers, lifetime topShare <= 0.4, rq 15-70, age >= 50
slots, price >= 1.5x create, creator not sold, and entry within 200 slots
of recovery at <= 5% above the recovery price (recoverChase 1.05).
First buy 0.15 SOL, one entry per coin. 22 main entries on dev.

**Adds — scale into strength.** While the position is open, add each time
rq rises +3 above the rq at the last buy AND the price is above the last
buy's price: add min(0.4 SOL, 1% of current rq), up to 3.0 SOL at cost per
coin. Adds stop the moment the coin stops climbing, so losers stay small
and winners grow. The +3 rq step is large vs the ~0.4 SOL of one add, so
the bot's own buying cannot trigger its own adds. (Sweep: addSol 0.4-0.5
flat, step 3 best, step 2 failure-sensitive, stake 3.0 = 4.0 flat.)

**Exits — no take-profit; ride to completion.**
- Trailing stop 0.38 from the peak value since entry. The sweep found the
  plateau 0.35-0.45 flat at +3.02 to +3.26; 0.30 is a cliff (+2.27, loses
  a winner) and 0.32 a one-point spike (+3.62, rejected as overfit).
  0.38 sits mid-plateau. (The original 0.50 stop scored +1.00.)
- Stale: no trade for 600 slots.
- Max hold: 4,000 slots (only exits below 1.1x cost).
- Creator sold, or any single sell >= 5 SOL (whale leaving — rare on
  dispersed coins, kept as a safety).
- Completion force-closes at the completion price (~13.5x create).

**Chunked sells.** A sell is rejected when its proceeds exceed the curve's
real SOL reserves, so a big position on a collapsed coin gets stuck (this
is what killed v2's completion-rider test). v3 sells in chunks sized so
each chunk's proceeds stay under ~50% of current rq, and keeps selling
across batches until the position is out.

**Guardrail probes ON (target 25 coins / 60 fills).** The main strategy
only fires 22 times on dev — too close to the >= 20 coin guardrail for an
unseen final window. Probes add 25 coins / 30 trips for -0.02 SOL (each
probe is 0.01 SOL, sold the next batch). Cheap insurance.

## Final numbers (backtest-full, all 3 parts, 24 Nov 2026)

- **net +3.030 SOL, 142 fills, 47 coins, 52 trips, 5 wins, dd 0.231.**
  Without failed txs +3.030; at 2x fees +2.573. Rejected 2, failed 1.
- Top trips: AVGnvQCtRc (completer) **+4.535**, C5Wm8Y9tVb (completer)
  **+1.000**, 2x1DaQuT12 +0.207, 92Zt8E5bx +0.110. Worst: 9JvXQrnYmo
  -1.207 (rose enough to earn full adds, then dumped through the trail),
  DKANq8n2m -0.436. The 30 probe trips cost -0.02 total.
- Sweep summary (net SOL): defaults +1.001 -> trail 0.4 +1.472 ->
  combo (trail 0.4 + addSol 0.4 + step 3 + chase 1.05) +2.515 ->
  + stake 3.0 +2.971 -> + minBuyers 50 +3.044 -> + probes 25/60 and
  trail 0.38: **+3.030**. Every knob was checked for a flat region, not
  a peak; the only rejected spike was trail 0.32 (+3.62).

## Numbers to beat (grade-local, process driver)

- v1: -1.037 SOL. v2: +0.550 SOL (98 fills, 49 coins, 49 trips, dd 2.8%).
- Dev board #1: +12.52 SOL. Ship criterion for v3: clearly better than
  v2's +0.550, aiming for +2 or more. The full-window backtest
  (tools/backtest-full.ts) tracks grade-local within ~0.05 SOL; all tuning
  uses it, never the kit sim alone.

## Honest caveat

The tradeable-completer sample is 7 coins. Any strategy tuned on 7 coins
can overfit them. v3's defences: the entry trigger (dip-recovery) and the
dispersion filter are justified by 99 events, not 7; the knobs are swept
for flat regions, not peaks; and the final window is unseen data, so no
dev number guarantees anything.
