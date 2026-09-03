import { createCache, sleep } from './cache.js';

const BASE = 'https://api.taostats.io/api';
const NETUID = Number(process.env.SUBNET_NETUID || 91);
const API_KEY = process.env.TAOSTATS_API_KEY;

// Measured ceiling is ~5 requests per 10s and a full refresh needs 5 calls, so
// every outbound call is serialized through one queue with a wide gap.
const MIN_REQUEST_GAP_MS = 2500;
let queueTail = Promise.resolve();
let lastRequestAt = 0;

function schedule(task) {
  const run = queueTail.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_GAP_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return task();
  });
  queueTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function apiFetch(url, attempt = 0) {
  const res = await schedule(() => fetch(url, { headers: { Authorization: API_KEY ?? '' } }));
  if (res.status === 429 && attempt < 2) {
    await sleep(3000 * 2 ** attempt);
    return apiFetch(url, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Taostats API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

const cached = createCache();

function requireKey() {
  if (!API_KEY) throw new Error('TAOSTATS_API_KEY is not set');
}

async function subnet() {
  requireKey();
  const r = await cached('subnet', 30_000, () => apiFetch(`${BASE}/subnet/latest/v1?netuid=${NETUID}`));
  return { data: r.data.data?.[0] ?? null, stale: r.stale, fetchedAt: r.fetchedAt };
}

async function metagraph() {
  requireKey();
  const r = await cached('metagraph', 30_000, () =>
    apiFetch(`${BASE}/metagraph/latest/v1?netuid=${NETUID}&limit=1024&order=emission_desc`)
  );
  return { data: r.data.data ?? [], stale: r.stale, fetchedAt: r.fetchedAt };
}

// These three endpoints accept a real netuid filter. The generic /extrinsic and
// /event endpoints silently ignore netuid — the latest rows network-wide are
// dominated by other subnets and almost never contain SN91 — so they are unusable here.
async function registrations() {
  const r = await cached('registrations', 25_000, () =>
    apiFetch(`${BASE}/subnet/neuron/registration/v1?netuid=${NETUID}&limit=50&order=block_number_desc`)
  );
  const events = (r.data.data ?? []).map((x) => ({
    id: `reg-${x.block_number}-${x.uid}`,
    category: 'registered',
    label: 'Registered',
    block_number: x.block_number,
    timestamp: x.timestamp,
    uid: x.uid,
    hotkey: x.hotkey?.ss58 ?? null,
    coldkey: x.coldkey?.ss58 ?? null,
    account: x.hotkey?.ss58 ?? null,
    cost: x.registration_cost,
  }));
  return { events, stale: r.stale };
}

async function deregistrations() {
  const r = await cached('deregistrations', 25_000, () =>
    apiFetch(`${BASE}/subnet/neuron/deregistration/v1?netuid=${NETUID}&limit=50&order=block_number_desc`)
  );
  const events = (r.data.data ?? []).map((x) => ({
    id: `dereg-${x.block_number}-${x.uid}`,
    category: 'deregistered',
    label: 'Deregistered',
    block_number: x.block_number,
    timestamp: x.timestamp,
    uid: x.uid,
    hotkey: x.hotkey?.ss58 ?? null,
    coldkey: x.coldkey?.ss58 ?? null,
    account: x.hotkey?.ss58 ?? null,
    incentive: x.incentive,
    emission: x.emission,
    was_drained: x.was_drained,
  }));
  return { events, stale: r.stale };
}

async function stakeEvents() {
  const r = await cached('delegation', 25_000, () =>
    apiFetch(`${BASE}/delegation/v1?netuid=${NETUID}&limit=100&order=block_number_desc`)
  );
  const events = (r.data.data ?? []).map((x) => ({
    id: x.id,
    category: x.action === 'UNDELEGATE' ? 'stake_removed' : 'stake_added',
    label: x.action === 'UNDELEGATE' ? 'Stake Removed' : 'Stake Added',
    block_number: x.block_number,
    timestamp: x.timestamp,
    account: x.nominator?.ss58 ?? null,
    delegate: x.delegate?.ss58 ?? null,
    amount: x.amount,
    alpha: x.alpha,
    usd: x.usd,
    alpha_price_in_tao: x.alpha_price_in_tao,
    alpha_price_in_usd: x.alpha_price_in_usd,
  }));
  return { events, stale: r.stale };
}

/**
 * Latest observed alpha price. Stake events carry a marked price per trade, so
 * the newest one prices rewards without spending another call against a tight
 * rate limit. Returns null rather than guessing when no trade has been seen.
 */
async function alphaPrice() {
  const { events, stale } = await stakeEvents();
  const priced = events.find((e) => e.alpha_price_in_tao != null);
  if (!priced) return null;
  return {
    tao: Number(priced.alpha_price_in_tao),
    usd: priced.alpha_price_in_usd != null ? Number(priced.alpha_price_in_usd) : null,
    observed_at: priced.timestamp,
    block_number: priced.block_number,
    stale,
  };
}

async function events() {
  requireKey();
  const names = ['registrations', 'deregistrations', 'stake'];
  const settled = await Promise.allSettled([registrations(), deregistrations(), stakeEvents()]);

  const list = settled
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value.events)
    .sort((a, b) => b.block_number - a.block_number)
    .slice(0, 200);

  return {
    events: list,
    degraded: names.filter((n, i) => settled[i].status === 'fulfilled' && settled[i].value.stale),
    missing: names.filter((n, i) => settled[i].status === 'rejected'),
  };
}

export const taostats = {
  hasKey: () => Boolean(API_KEY),
  subnet,
  metagraph,
  events,
  alphaPrice,
};
