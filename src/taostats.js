import { createCache, sleep } from './cache.js';

const BASE = 'https://api.taostats.io/api';
const NETUID = Number(process.env.SUBNET_NETUID || 91);
const API_KEY = process.env.TAOSTATS_API_KEY;

/**
 * Budgeted for the Taostats FREE tier: 5 calls/minute, 10,000 calls/month.
 *
 * Block height, alpha price and this round's commits come free from the
 * subnet's own status/chain.json, so Taostats is only needed for per-miner
 * chain state. 10,000/month is ~13.9 calls/hour sustained, so cache lifetimes — not client
 * poll intervals — are what actually govern spend: a page refresh inside a TTL
 * is served from cache and costs nothing. The allocation below spends ~12/hr,
 * weighted toward the data that visibly moves:
 *
 *   subnet (key counts, burn)       every 30 min  ->  2 /hr
 *   metagraph (ranks, stake)       every 20 min  ->  3 /hr
 *   chain events (3 endpoints)     every 60 min  ->  3 /hr
 *                                                  = 8 /hr
 *
 * Raise these if you upgrade the plan; lower them only with the monthly budget in mind.
 */
const TTL = {
  subnet: Number(process.env.TTL_SUBNET_MS ?? 30 * 60_000),
  metagraph: Number(process.env.TTL_METAGRAPH_MS ?? 20 * 60_000),
  events: Number(process.env.TTL_EVENTS_MS ?? 60 * 60_000),
};

/**
 * "5 calls per minute" is a token bucket, not a mandatory 12s spacing — five
 * calls back to back are within the limit, and only the sixth has to wait.
 * Modelling it as a fixed gap made a cold page load take 48s to warm five
 * endpoints that the allowance permits immediately; the bucket refills at the
 * same sustained rate, so the budget is unchanged.
 */
const RATE_CAPACITY = Number(process.env.TAOSTATS_RATE_CAPACITY ?? 5);
const RATE_WINDOW_MS = Number(process.env.TAOSTATS_RATE_WINDOW_MS ?? 60_000);
const REFILL_MS = RATE_WINDOW_MS / RATE_CAPACITY;

let tokens = RATE_CAPACITY;
let lastRefill = Date.now();
let queueTail = Promise.resolve();

function takeToken() {
  const now = Date.now();
  const gained = Math.floor((now - lastRefill) / REFILL_MS);
  if (gained > 0) {
    tokens = Math.min(RATE_CAPACITY, tokens + gained);
    lastRefill += gained * REFILL_MS;
  }
  if (tokens >= 1) {
    tokens -= 1;
    return 0;
  }
  return Math.max(0, lastRefill + REFILL_MS - now);
}

function schedule(task) {
  const run = queueTail.then(async () => {
    // Re-check on reaching the front of the queue, not just on entering it. A
    // page fires ~5 calls at once, so they all queue before the first failure
    // registers; without this they would each still sit out a full wait for a
    // request that is now guaranteed to fail.
    if (Date.now() < creditsExhaustedUntil) throw new OutOfCreditsError(creditsDetail);

    for (;;) {
      const wait = takeToken();
      if (wait === 0) break;
      await sleep(wait);
      if (Date.now() < creditsExhaustedUntil) throw new OutOfCreditsError(creditsDetail);
    }
    return task();
  });
  queueTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Taostats returns 429 for two completely different conditions: a transient
 * per-second rate limit (retrying works) and an exhausted credit balance
 * (retrying never works). Retrying the latter turned an 87ms rejection into
 * 9-22s of backoff per request, which is why pages appeared to hang.
 */
export class OutOfCreditsError extends Error {
  constructor(detail) {
    super(`Taostats credits exhausted — ${detail}`);
    this.name = 'OutOfCreditsError';
    this.outOfCredits = true;
  }
}

const CREDIT_COOLDOWN_MS = 5 * 60 * 1000;
let creditsExhaustedUntil = 0;
let creditsDetail = '';

export function creditStatus() {
  const blocked = Date.now() < creditsExhaustedUntil;
  return { blocked, detail: blocked ? creditsDetail : null, retryAt: blocked ? creditsExhaustedUntil : null };
}

async function apiFetch(url, attempt = 0) {
  // Once the balance is empty every further call is guaranteed to fail, so stop
  // spending latency (and the request budget) on them until the cooldown lapses.
  if (Date.now() < creditsExhaustedUntil) throw new OutOfCreditsError(creditsDetail);

  // The response body must be inspected INSIDE the queued task. A 429 is a
  // *resolved* fetch, so reading it afterwards let the queue release the next
  // call before the exhaustion was recorded — and that call then sat out a full
  // inter-request gap for a request already doomed to fail.
  const outcome = await schedule(async () => {
    const res = await fetch(url, { headers: { Authorization: API_KEY ?? '' } });

    if (res.status === 429) {
      const text = await res.text().catch(() => '');
      if (/insufficient credits/i.test(text)) {
        creditsExhaustedUntil = Date.now() + CREDIT_COOLDOWN_MS;
        creditsDetail = (text.match(/remaining: \d+[^)]*/i)?.[0] ?? 'balance empty').trim();
        throw new OutOfCreditsError(creditsDetail);
      }
      return { rateLimited: true, text };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Taostats API ${res.status}: ${text.slice(0, 200)}`);
    }
    return { json: await res.json() };
  });

  if (outcome.rateLimited) {
    if (attempt < 2) {
      await sleep(3000 * 2 ** attempt);
      return apiFetch(url, attempt + 1);
    }
    throw new Error(`Taostats API 429: ${outcome.text.slice(0, 200)}`);
  }
  return outcome.json;
}

const cached = createCache();

function requireKey() {
  if (!API_KEY) throw new Error('TAOSTATS_API_KEY is not set');
}

async function subnet() {
  requireKey();
  const r = await cached('subnet', TTL.subnet, () => apiFetch(`${BASE}/subnet/latest/v1?netuid=${NETUID}`));
  return { data: r.data.data?.[0] ?? null, stale: r.stale, fetchedAt: r.fetchedAt };
}

async function metagraph() {
  requireKey();
  const r = await cached('metagraph', TTL.metagraph, () =>
    apiFetch(`${BASE}/metagraph/latest/v1?netuid=${NETUID}&limit=1024&order=emission_desc`)
  );
  return { data: r.data.data ?? [], stale: r.stale, fetchedAt: r.fetchedAt };
}

// These three endpoints accept a real netuid filter. The generic /extrinsic and
// /event endpoints silently ignore netuid — the latest rows network-wide are
// dominated by other subnets and almost never contain SN91 — so they are unusable here.
async function registrations() {
  const r = await cached('registrations', TTL.events, () =>
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
  const r = await cached('deregistrations', TTL.events, () =>
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
  const r = await cached('delegation', TTL.events, () =>
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
