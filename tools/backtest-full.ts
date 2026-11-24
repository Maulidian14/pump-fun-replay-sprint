// Full-window offline backtest of strategy.ts on the kit's dev window.
//
// The kit sim's loadDataset reads ONLY part-00000 (the first ~46% of the
// window); the grader reads all three parts (128,058 events, 1,222 mints).
// That is why v1's sim (-0.14 SOL, 144 coins) and its grade-local (-1.04 SOL,
// 367 coins) disagreed so much. This tool loads every part file and runs the
// same sim engine, so its numbers track grade-local. Dev tooling only; the
// grader never runs it.
//
//   node tools/backtest-full.ts <kit dir> ['{"takeProfit":0.6}'] [--trips]

import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createStrategy, DEFAULT_PARAMS, type Params } from '../strategy.ts';
import { makeHello, phaseSeed, simulate, type Dataset } from '../../../new6-20261124/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122-kit/baselines/pilot/momentum/tools/sim.ts';

const kit = process.argv[2];
if (kit === undefined) {
  console.error('usage: node tools/backtest-full.ts <kit dir> [params json] [--trips]');
  process.exit(2);
}
const showTrips = process.argv.includes('--trips');
const overrides = process.argv[3] !== undefined && process.argv[3].startsWith('{') ? (JSON.parse(process.argv[3]) as Partial<Params>) : {};

function loadFullDataset(kitDir: string): Dataset {
  const kitJson = JSON.parse(readFileSync(`${kitDir}/kit.json`, 'utf8'));
  const manifest = JSON.parse(readFileSync(`${kitDir}/dataset/manifest.json`, 'utf8'));
  const { modulus, residue } = manifest.universe.sample;
  const excluded = new Set<string>(manifest.excluded_mints ?? []);
  const parts = readdirSync(`${kitDir}/dataset/events`).filter((f) => f.endsWith('.ndjson.gz')).sort();
  const all: any[] = [];
  for (const part of parts) {
    const raw = gunzipSync(readFileSync(`${kitDir}/dataset/events/${part}`)).toString('utf8');
    for (const line of raw.split('\n')) {
      if (line.length > 0) all.push(JSON.parse(line));
    }
  }
  const members = new Set<string>();
  const events: any[] = [];
  for (const e of all) {
    if (e.event === 'CreateEvent' && !members.has(e.mint)) {
      const h = BigInt('0x' + createHash('sha256').update(e.mint, 'utf8').digest('hex'));
      if (e.quote_mint === '11111111111111111111111111111111' && !e.is_mayhem_mode && !e.is_cashback_enabled && !excluded.has(e.mint) && h % BigInt(modulus) === BigInt(residue)) {
        members.add(e.mint);
      }
    }
    if (members.has(e.mint)) events.push(e);
  }
  const batches: { slot: number; events: any[] }[] = [];
  for (const e of events) {
    const tail = batches[batches.length - 1];
    if (tail !== undefined && tail.slot === e.slot) tail.events.push(e);
    else batches.push({ slot: e.slot, events: [e] });
  }
  const lastSlot = all.length > 0 ? all[all.length - 1].slot : 0;
  return { sha256: kitJson.dataset_sha256, events, endSlot: manifest.window?.end_slot ?? lastSlot, batches };
}

const ds = loadFullDataset(kit);
console.log(`full dataset: ${ds.events.length} events, ${ds.batches.length} batches`);
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
