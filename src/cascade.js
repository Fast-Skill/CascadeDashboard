import { createCache } from './cache.js';

// Validators publish signed round receipts here with public-read ACLs, which is
// what makes third-party audit (and this dashboard) possible without credentials.
const RECEIPTS_BASE = process.env.CASCADE_RECEIPTS_BASE || 'https://s3.hippius.com/cascade-manifests';

const cached = createCache();

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cascade receipts ${res.status} for ${url.replace(RECEIPTS_BASE, '')}`);
  return res.json();
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Mean pinball loss normalised by the window's absolute target — the per-window
 * quantile-loss figure the CRPS geomean is built from. Kept as a descriptive
 * statistic only; the official number is the validator's own `geomean`.
 */
function normalisedQLoss(score) {
  const q = score.qloss_per_q;
  if (!Array.isArray(q) || !q.length || !score.abs_target) return null;
  return q.reduce((a, b) => a + b, 0) / (q.length * score.abs_target);
}

function histogram(values, bins = 24) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Clip the long right tail so the shape stays legible.
  const lo = sorted[0];
  const hi = quantile(sorted, 0.98);
  const width = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
    counts[i] += 1;
  }
  return { lo, hi, width, counts };
}

function summariseEntry(entry) {
  const mases = [];
  const nqs = [];
  for (const s of entry.scores ?? []) {
    if (typeof s.mase === 'number' && Number.isFinite(s.mase)) mases.push(s.mase);
    const nq = normalisedQLoss(s);
    if (nq !== null && Number.isFinite(nq)) nqs.push(nq);
  }
  const sortedM = [...mases].sort((a, b) => a - b);
  return {
    uid: entry.uid,
    role: entry.role,
    hotkey: entry.hotkey,
    size: entry.size,
    n_windows: entry.scores?.length ?? 0,
    mase_mean: mean(mases),
    mase_median: median(mases),
    mase_p10: quantile(sortedM, 0.1),
    mase_p90: quantile(sortedM, 0.9),
    nqloss_mean: mean(nqs),
    hist: histogram(mases),
  };
}

/**
 * Per-window head-to-head against the king, recomputed from the published
 * scores. The receipt's own `win_rate` covers the scored challenger; deriving
 * it for every entry shows how each one actually fared window by window.
 */
function headToHead(entries) {
  const king = entries.find((e) => e.role === 'king');
  if (!king) return [];
  const kingByWindow = new Map();
  (king.scores ?? []).forEach((s, i) => kingByWindow.set(s.series_id ?? i, s.mase));

  return entries
    .filter((e) => e !== king)
    .map((e) => {
      let wins = 0;
      let n = 0;
      (e.scores ?? []).forEach((s, i) => {
        const k = kingByWindow.get(s.series_id ?? i);
        if (typeof k === 'number' && typeof s.mase === 'number') {
          n += 1;
          if (s.mase < k) wins += 1;
        }
      });
      return { uid: e.uid, role: e.role, wins, n, win_rate: n ? wins / n : null };
    });
}

function newestFirst(a, b) {
  if (b.epoch_start_block !== a.epoch_start_block) return b.epoch_start_block - a.epoch_start_block;
  return String(b.published_at ?? '').localeCompare(String(a.published_at ?? ''));
}

/**
 * One row per round, with every validator's receipt for that round attached.
 * Each validator publishes independently, so a round can be `scored` by two and
 * `rejected` by a third — that disagreement is the audit signal, not noise.
 */
function groupRounds(rounds) {
  const byRound = new Map();
  for (const r of rounds) {
    const key = String(r.round_id);
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push(r);
  }

  return [...byRound.entries()]
    .map(([round_id, receipts]) => {
      receipts.sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')));
      const scored = receipts.filter((r) => r.status === 'scored');
      // Prefer a scored receipt as the canonical view of the round.
      const canonical = scored[0] ?? receipts[0];

      const kingViews = new Set(
        scored.map((r) => `${r.post_round_king_uid}|${r.dethroned}`)
      );

      return {
        ...canonical,
        round_id,
        n_receipts: receipts.length,
        n_scored: scored.length,
        n_rejected: receipts.filter((r) => r.status === 'rejected').length,
        validators_disagree: kingViews.size > 1,
        receipts: receipts.map((r) => ({
          validator_hotkey: r.validator_hotkey,
          status: r.status,
          reject_reason: r.reject_reason,
          published_at: r.published_at,
          receipt_key: r.receipt_key,
          post_round_king_uid: r.post_round_king_uid,
          dethroned: r.dethroned,
          n_rewarded: r.n_rewarded,
        })),
      };
    })
    .sort(newestFirst);
}

/** Contiguous reigns, derived by walking rounds oldest→newest. */
function reignChain(rounds) {
  const chrono = [...rounds].reverse().filter((r) => r.status === 'scored' && r.post_round_king_uid != null);
  const reigns = [];
  for (const r of chrono) {
    const last = reigns[reigns.length - 1];
    if (last && last.uid === r.post_round_king_uid) {
      last.rounds += 1;
      last.to_block = r.epoch_start_block;
      last.to = r.published_at;
    } else {
      reigns.push({
        uid: r.post_round_king_uid,
        hotkey: r.post_round_king_hotkey,
        rounds: 1,
        from_block: r.epoch_start_block,
        to_block: r.epoch_start_block,
        from: r.published_at,
        to: r.published_at,
        gen_ref: null,
      });
    }
    // `king_gen_ref` is the generator of the king going INTO the round, so it
    // only names this reign's generator once the holder is defending, not on the
    // round they won on (where it still points at the king they dethroned).
    const current = reigns[reigns.length - 1];
    if (r.king_uid === current.uid && r.king_gen_ref) current.gen_ref = r.king_gen_ref;
  }
  return reigns.reverse();
}

async function roundIndex() {
  const r = await cached('index', 120_000, () => getJSON(`${RECEIPTS_BASE}/receipts/index.json`));
  const raw = r.data;
  const rounds = groupRounds(raw.rounds ?? []);

  // Chain figures here are a snapshot from when the index was published, which
  // can be hours old. Epoch boundaries are multiples of epoch_blocks, so the
  // client recomputes live progress against the current block instead.
  const chain = raw.chain ?? {};

  return {
    subnet: raw.subnet ?? null,
    updated_at: raw.updated_at ?? null,
    chain: { ...chain, epoch_blocks: chain.epoch_blocks ?? 3600 },
    totals: {
      rounds: rounds.length,
      receipts: (raw.rounds ?? []).length,
      scored: rounds.filter((x) => x.status === 'scored').length,
      rejected: rounds.filter((x) => x.status === 'rejected').length,
      dethrones: rounds.filter((x) => x.dethroned).length,
    },
    reigns: reignChain(rounds),
    rounds,
    stale: r.stale,
    fetchedAt: r.fetchedAt,
  };
}

async function latestRound() {
  const idx = await roundIndex();
  return {
    chain: idx.chain,
    round: idx.rounds[0] ?? null,
    previous: idx.rounds.slice(1, 6),
    reign: idx.reigns[0] ?? null,
    totals: idx.totals,
    updated_at: idx.updated_at,
    stale: idx.stale,
  };
}

/**
 * Full detail for one round. The raw receipt is ~4.4MB (1200 per-window scores
 * per entry), so it is aggregated here and only the summary is cached — the
 * browser never sees the raw score arrays.
 */
async function roundDetail(roundId) {
  const idx = await roundIndex();
  const round = idx.rounds.find((r) => String(r.round_id) === String(roundId));
  if (!round) throw new Error(`Unknown round ${roundId}`);

  const r = await cached(`round:${roundId}`, 6 * 60 * 60 * 1000, async () => {
    // Prefer a scored receipt; a rejected one carries no scores to summarise.
    const source = round.receipts.find((x) => x.status === 'scored') ?? round.receipts[0];
    const receipt = await getJSON(`${RECEIPTS_BASE}/${source.receipt_key}`);

    const entries = receipt.entry_scores ?? [];
    const weights = receipt.weights ?? [];

    return {
      source_receipt: source,
      receipt_version: receipt.receipt_version,
      status: receipt.status,
      reject_reason: receipt.reject_reason,
      validator_hotkey: receipt.validator_hotkey,
      signature: receipt.signature,
      epoch_start_block: receipt.epoch_start_block,
      epoch_block_hash: receipt.epoch_block_hash,
      seeds: {
        base: receipt.base_seed,
        generation: receipt.generation_seed,
        training: receipt.training_seed,
        bootstrap: receipt.verdict?.bootstrap_seed,
      },
      verdict: receipt.verdict ?? null,
      eval_context: {
        n_windows: receipt.eval_context?.n_windows,
        num_samples: receipt.eval_context?.num_samples,
        pool_ref: receipt.eval_context?.pool_ref,
        pool_digest: receipt.eval_context?.pool_digest,
      },
      manifest: {
        round_id: receipt.manifest?.round_id,
        manifest_version: receipt.manifest?.manifest_version,
        created_block: receipt.manifest?.created_block,
        contract_digest: receipt.manifest?.contract_digest,
        base_arch_digest: receipt.manifest?.base_arch_digest,
        eval_dataset: receipt.manifest?.eval_dataset,
        eval_pool_key: receipt.manifest?.eval_pool_key,
        eval_pool_sha256: receipt.manifest?.eval_pool_sha256,
        warm_start_ckpt: receipt.manifest?.warm_start_ckpt,
        warm_start_size: receipt.manifest?.warm_start_size,
        signature: receipt.manifest?.signature,
        contract_body: receipt.manifest?.contract_body ?? null,
        composition: receipt.manifest?.composition ?? null,
      },
      heat: receipt.manifest?.heat ?? null,
      entries: receipt.manifest?.entries ?? [],
      entry_summaries: entries.map(summariseEntry),
      head_to_head: headToHead(entries),
      participants: receipt.participants ?? [],
      reward_uids: receipt.reward_uids ?? [],
      weights: weights
        .map((w, uid) => ({ uid, weight: w }))
        .filter((x) => x.weight > 0)
        .sort((a, b) => b.weight - a.weight),
    };
  });

  return {
    round,
    detail: r.data,
    epoch_blocks: idx.chain?.epoch_blocks ?? 3600,
    stale: r.stale,
    fetchedAt: r.fetchedAt,
  };
}

/**
 * The trainer's live stage machine, in the order loop.py publishes it:
 * screening → head-to-head duel → validators verifying → receipts on record.
 * `final` appears in the codebase only as a host-capability filter, not a stage.
 */
export const STAGES = [
  {
    key: 'heat',
    label: 'Heat',
    blurb: 'Every committed generator trains a short screening run and is ranked by CRPS.',
  },
  {
    key: 'duel',
    label: 'Duel',
    blurb: 'Finalists and the reigning king each train the full model on their own corpus.',
  },
  {
    key: 'validation',
    label: 'Validation',
    blurb: 'The manifest is published and validators independently re-score and verify it.',
  },
  {
    key: 'published',
    label: 'Published',
    blurb: 'Signed receipts are on public record and weights are set on chain.',
  },
];

/**
 * Live view of the round in flight.
 *
 * The heat pointer is a single-writer, best-effort mirror that keeps serving the
 * PREVIOUS round's standings until this round's heat settles, so it is only
 * presented as live when its epoch_start_block matches the round in flight —
 * otherwise a dashboard shows last round's ranking as this round's.
 */
async function liveStatus() {
  // status/chain.json is what the subnet's own dashboard runs on. It is free and
  // unmetered, and carries the live block height, the alpha price and this
  // round's on-chain commits — all of which we were otherwise buying from
  // Taostats one credit at a time.
  const [statusRes, heatRes, chainRes, idx] = await Promise.allSettled([
    cached('status:round', 20_000, () => getJSON(`${RECEIPTS_BASE}/status/round.json`)),
    cached('status:heat', 30_000, () => getJSON(`${RECEIPTS_BASE}/status/heat.json`)),
    cached('status:chain', 20_000, () => getJSON(`${RECEIPTS_BASE}/status/chain.json`)),
    roundIndex(),
  ]);

  const status = statusRes.status === 'fulfilled' ? statusRes.value.data : null;
  const heatDoc = heatRes.status === 'fulfilled' ? heatRes.value.data : null;
  const chainDoc = chainRes.status === 'fulfilled' ? chainRes.value.data : null;
  const index = idx.status === 'fulfilled' ? idx.value : null;

  const epoch = status?.epoch_start_block ?? null;
  const roundId = status?.round_id != null ? String(status.round_id) : null;
  const heatIsCurrent = Boolean(heatDoc && epoch != null && heatDoc.epoch_start_block === epoch);

  // Which validators have already certified this round, and which are still working.
  const known = new Map();
  for (const r of index?.rounds?.slice(0, 12) ?? []) {
    for (const rc of r.receipts) known.set(rc.validator_hotkey, true);
  }
  const thisRound = index?.rounds?.find((r) => String(r.round_id) === roundId) ?? null;
  const published = new Map((thisRound?.receipts ?? []).map((rc) => [rc.validator_hotkey, rc]));

  const validators = [...known.keys()].map((hotkey) => {
    const rc = published.get(hotkey);
    return {
      hotkey,
      published: Boolean(rc),
      status: rc?.status ?? null,
      reject_reason: rc?.reject_reason ?? null,
      published_at: rc?.published_at ?? null,
    };
  });

  const stageIndex = STAGES.findIndex((s) => s.key === status?.stage);

  // One list per submitted generator, screened and rejected together, so the
  // verification state of every submission reads in a single pass.
  const entrants = heatDoc?.entrants ?? [];
  const skipped = heatDoc?.skipped ?? null;
  const skippedEntries = skipped?.entries ?? [];

  const submissions = [
    ...entrants.map((e) => ({
      uid: e.uid,
      hotkey: e.hotkey,
      gen_ref: e.gen_ref,
      state: e.status === 'advanced' ? 'advanced' : 'screened',
      rank: e.rank ?? null,
      crps: e.crps ?? null,
      mase: e.mase ?? null,
      p_best: e.p_best ?? null,
      reason: null,
    })),
    ...skippedEntries.map((s) => ({
      uid: s.uid ?? null,
      hotkey: s.hotkey,
      gen_ref: null,
      state: 'rejected',
      rank: null,
      crps: null,
      mase: null,
      p_best: null,
      reason: s.reason ?? 'unknown',
    })),
  ];

  const rejectedTotal = Number(skipped?.total ?? 0);

  // Commits for the round actually in flight. The heat mirror only publishes
  // once a screen settles, so before that these are the only per-miner facts
  // that belong to the current round rather than the previous one.
  const committedNow = (chainDoc?.submissions ?? []).map((s) => ({
    uid: s.uid,
    hotkey: s.hotkey,
    gen_ref: s.gen_ref,
    commit_block: s.commit_block,
  }));

  return {
    chain: chainDoc
      ? {
          current_block: chainDoc.current_block ?? null,
          block_time_s: chainDoc.block_time_s ?? 12,
          epoch_blocks: chainDoc.epoch_blocks ?? 3600,
          epoch_start_block: chainDoc.epoch_start_block ?? null,
          network: chainDoc.network ?? null,
          alpha_price_tao: chainDoc.economics?.alpha_price_tao ?? null,
          tao_emission_per_day: chainDoc.economics?.tao_in_emission_per_day ?? null,
          stage_windows: chainDoc.stage_windows ?? null,
          as_of: chainDoc.as_of ?? null,
        }
      : null,
    committed_now: committedNow,
    committed_now_count: committedNow.length,
    submissions,
    submission_counts: {
      // The published doc truncates the rejected list, so the total and the
      // number of rows that can actually be listed are reported separately.
      submitted: entrants.length + rejectedTotal,
      screened: entrants.length,
      advanced: entrants.filter((e) => e.status === 'advanced').length,
      rejected: rejectedTotal,
      rejected_listed: skippedEntries.length,
      rejected_truncated: Boolean(skipped?.entries_truncated),
      by_reason: skipped?.by_reason ?? {},
    },
    as_of: status?.as_of ?? null,
    round_id: roundId,
    epoch_start_block: epoch,
    epoch_blocks: index?.chain?.epoch_blocks ?? 3600,
    block_time_s: index?.chain?.block_time_s ?? 12,
    stage: status?.stage ?? null,
    stage_index: stageIndex,
    stages: STAGES,
    heat_done: status?.heat_done ?? null,
    heat_total: status?.heat_total ?? null,
    warm_start: status?.warm_start ?? null,
    heat: heatDoc
      ? {
          is_current: heatIsCurrent,
          epoch_start_block: heatDoc.epoch_start_block,
          round_id: heatDoc.round_id != null ? String(heatDoc.round_id) : null,
          as_of: heatDoc.as_of,
          screen_size: heatDoc.screen_size,
          screened: heatDoc.screened,
          finalists: heatDoc.finalists,
          no_screen: Boolean(heatDoc.no_screen),
          no_screen_reason: heatDoc.no_screen_reason ?? null,
          leader_lcb: heatDoc.leader_lcb ?? null,
          n_windows: heatDoc.n_windows ?? null,
          n_clusters: heatDoc.n_clusters ?? null,
          entrants: heatDoc.entrants ?? [],
          skipped: heatDoc.skipped ?? null,
        }
      : null,
    validators,
    last_published_round: index?.rounds?.[0] ?? null,
    stale: statusRes.status === 'fulfilled' ? statusRes.value.stale : true,
  };
}

export const cascade = { roundIndex, latestRound, roundDetail, liveStatus };
