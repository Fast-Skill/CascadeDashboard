import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { taostats, creditStatus } from './src/taostats.js';
import { cascade } from './src/cascade.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 3000;
const NETUID = Number(process.env.SUBNET_NETUID || 91);

const PAGES = ['index', 'rounds', 'round', 'miners', 'verification'];

// Retired standalone pages — their content now lives inside Rounds and Miners.
const MOVED = { '/live': '/rounds', '/rewards': '/miners', '/chain': '/miners' };

app.use(express.static(path.join(__dirname, 'public')));

// Clean URLs: /rounds -> public/rounds.html
for (const page of PAGES) {
  const route = page === 'index' ? '/' : `/${page}`;
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
}

for (const [from, to] of Object.entries(MOVED)) {
  app.get(from, (req, res) => res.redirect(301, to));
}

function wrap(handler) {
  return async (req, res) => {
    try {
      res.json(await handler(req));
    } catch (err) {
      console.error(`[cascade-dash] ${req.path}: ${err.message}`);
      res.status(502).json({ error: err.message });
    }
  };
}

app.get('/api/config', (req, res) => {
  res.json({ netuid: NETUID, apiKeyConfigured: taostats.hasKey(), credits: creditStatus() });
});

// --- chain data (Taostats) ---
app.get('/api/subnet', wrap(() => taostats.subnet()));
app.get('/api/metagraph', wrap(() => taostats.metagraph()));
app.get('/api/events', wrap(() => taostats.events()));

// --- subnet application data (Cascade round receipts) ---
app.get('/api/cascade/rounds', wrap(() => cascade.roundIndex()));
app.get('/api/cascade/latest', wrap(() => cascade.latestRound()));
app.get('/api/cascade/live', wrap(() => cascade.liveStatus()));
app.get('/api/cascade/round/:roundId', wrap((req) => cascade.roundDetail(req.params.roundId)));

// Public-benchmark comparison for a round. Defaults to the latest round and the
// preset that round actually trained, since only some presets are published.
app.get('/api/cascade/benchmarks', wrap(async (req) => {
  const latest = await cascade.latestRound();
  const roundId = req.query.round ?? latest.round?.round_id;
  const preset = req.query.preset ?? latest.round?.sizes?.[0] ?? 'toto2-4m';
  if (!roundId) return { available: false, entries: [] };
  return cascade.benchmarks(roundId, preset);
}));

/**
 * Reward distribution by rank. The receipt says what share each uid was assigned;
 * the metagraph says what that share is actually paying out. Joining them turns a
 * weight fraction into an amount, priced in α, τ and USD.
 */
app.get('/api/rewards', wrap(async () => {
  const [latest, mgRes, priceRes] = await Promise.allSettled([
    cascade.latestRound(),
    taostats.metagraph(),
    taostats.alphaPrice(),
  ]);

  const round = latest.status === 'fulfilled' ? latest.value.round : null;
  const neurons = mgRes.status === 'fulfilled' ? mgRes.value.data : [];

  // Taostats prices alpha in both TAO and USD, but the subnet's own free status
  // doc carries the TAO price — so τ figures survive an empty credit balance
  // even though USD (which only Taostats provides) does not.
  let price = priceRes.status === 'fulfilled' ? priceRes.value : null;
  if (!price) {
    const live = await cascade.liveStatus().catch(() => null);
    const tao = live?.chain?.alpha_price_tao;
    if (tao != null) {
      price = { tao, usd: null, observed_at: live.chain.as_of, block_number: live.chain.current_block, stale: false };
    }
  }
  const byUid = new Map(neurons.map((n) => [n.uid, n]));

  // Amounts come from the chain, not from the weight fraction. If the metagraph
  // is unavailable the page would otherwise render a table of dashes with no
  // explanation, so say which source is missing.
  const unavailable = [];
  if (mgRes.status === 'rejected' || !neurons.length) unavailable.push('metagraph');
  if (!price) unavailable.push('alpha price');
  if (latest.status === 'rejected') unavailable.push('rounds');

  let weights = [];
  if (round) {
    const detail = await cascade.roundDetail(round.round_id);
    weights = detail.detail.weights ?? [];
  }

  const totalWeight = weights.reduce((a, w) => a + w.weight, 0) || 1;
  const ranks = weights.map((w, i) => {
    const n = byUid.get(w.uid);
    const dailyAlpha = n ? Number(n.daily_reward) / 1e9 : null;
    return {
      rank: i + 1,
      uid: w.uid,
      hotkey: n?.hotkey?.ss58 ?? null,
      weight: w.weight,
      share: w.weight / totalWeight,
      incentive: n ? Number(n.incentive) : null,
      emission_alpha: n ? Number(n.emission) / 1e9 : null,
      daily_alpha: dailyAlpha,
      daily_tao: dailyAlpha != null && price ? dailyAlpha * price.tao : null,
      daily_usd: dailyAlpha != null && price?.usd != null ? dailyAlpha * price.usd : null,
      // Each step down the reign chain is meant to halve; showing the measured
      // ratio makes a drift from that visible rather than assumed.
      decay_from_previous: null,
    };
  });

  for (let i = 1; i < ranks.length; i += 1) {
    const prev = ranks[i - 1].daily_alpha;
    const cur = ranks[i].daily_alpha;
    ranks[i].decay_from_previous = prev && cur ? cur / prev : null;
  }

  const minerTotal = ranks.reduce((a, r) => a + (r.daily_alpha ?? 0), 0);
  const subnetTotal = neurons.reduce((a, n) => a + Number(n.daily_reward ?? 0) / 1e9, 0);

  return {
    round: round
      ? { round_id: round.round_id, epoch_start_block: round.epoch_start_block, published_at: round.published_at }
      : null,
    price,
    ranks,
    unavailable,
    totals: {
      miner_daily_alpha: minerTotal,
      subnet_daily_alpha: subnetTotal,
      validator_daily_alpha: subnetTotal - minerTotal,
      rewarded_uids: ranks.length,
    },
  };
}));

app.listen(PORT, () => {
  console.log(`Cascade (SN${NETUID}) dashboard running at http://localhost:${PORT}`);
  if (!taostats.hasKey()) {
    console.warn(
      '[cascade-dash] TAOSTATS_API_KEY is not set — chain pages will be empty.\n' +
        '  Get a key at https://taostats.io/pro, then copy .env.example to .env and paste it in.\n' +
        '  Round/scoring pages work without it (they read the public Cascade receipt store).'
    );
  }
});
