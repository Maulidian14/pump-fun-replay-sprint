// Offline backtest of strategy.ts on the kit's dev window with the kit's local engine
// port (baselines/pilot/momentum/tools/sim.ts). Dev tooling only; the grader never runs it.
//
//   node tools/backtest.ts <kit dir> ['{"takeProfit":0.6}'] [--trips]
//
// Prints net PnL, fills, coins, drawdown and reject reasons; --trips lists every round trip.

import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { loadDataset, makeHello, phaseSeed, simulate } from '../../../new6-20261124/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-kit/baselines/pilot/momentum/tools/sim.ts';

const kit = process.argv[2];
if (kit === undefined) {
  console.error('usage: node tools/backtest.ts <kit dir> [params json] [--trips]');
  process.exit(2);
}
const showTrips = process.argv.includes('--trips');
const overrides = process.argv[3] !== undefined && process.argv[3].startsWith('{') ? (JSON.parse(process.argv[3]) as Partial<Params>) : {};
const ds = loadDataset(kit);
const hello = makeHello(phaseSeed('pilot-pumpfun-replay', 'dev', ds.sha256));
const params = { ...DEFAULT_PARAMS, ...overrides };
const sol = (x: bigint) => (Number(x) / 1e9).toFixed(6);

const r = simulate(ds, hello, createStrategy(params));
const wins = r.trips.filter((t) => t.pnl > 0n).length;
console.log(`net ${sol(r.netPnl)} SOL  fills ${r.fills}  coins ${r.mints}  trips ${r.trips.length}  wins ${wins}  dd ${r.maxDrawdown.toFixed(4)}  rejected ${r.rejected} ${JSON.stringify(r.rejectReasons)}  failed ${r.failed}`);
const noFail = simulate(ds, hello, createStrategy(params), { failKey: null });
const twoX = simulate(ds, hello, createStrategy(params), { feeMultiplier: 2n });
console.log(`without failed txs ${sol(noFail.netPnl)}  at 2x fees ${sol(twoX.netPnl)}`);
if (showTrips) {
  for (const t of r.trips) console.log(t.mint, t.open, t.close - t.open, sol(t.pnl));
}
