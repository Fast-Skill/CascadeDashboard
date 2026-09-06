import {
  mountChrome,
  setStatus,
  markUpdated,
  fetchJSON,
  esc,
  fmtNum,
  fmtFixed,
  fmtPct,
  fmtRao,
  fmtDuration,
  shortAddr,
  shortGenRef,
  barCell,
  showError,
  checkCredits,
} from './common.js';
import { mountRewards } from './sections/rewards.js';
import { mountChain } from './sections/chain.js';

mountChrome();
checkCredits();

let rows = [];
/** Reference data the row renderers need but that isn't per-row. */
let tableMeta = { refBlock: null, blockTimeS: 12, certified: null, receipts: null };

/**
 * The chain knows uid → stake/incentive/emission; the round receipt knows
 * uid → what that miner actually submitted and how it scored. Joining on uid
 * is what turns two partial views into a miner leaderboard.
 */
function buildRows(neurons, detail) {
  const heat = new Map((detail?.heat?.entrants ?? []).map((e) => [e.uid, e]));
  const finals = new Map((detail?.entries ?? []).map((e) => [e.miner_uid, e]));
  const committed = new Map((detail?.participants ?? []).map((p) => [p.uid, p]));
  const weights = new Map((detail?.weights ?? []).map((w) => [w.uid, w.weight]));
  const summaries = new Map((detail?.entry_summaries ?? []).map((s) => [s.uid, s]));

  return neurons.map((n) => {
    const uid = n.uid;
    const h = heat.get(uid);
    const f = finals.get(uid);
    return {
      // Only the final-phase duel is scored inside the validators' signed
      // receipt. The heat block is explicitly excluded from the receipt's
      // canonical_body (DEC-CA-0011: unsigned, single-writer, presentational),
      // so heat CRPS/MASE are provisional trainer output, not certified values.
      verified: f ? 'final' : h ? 'heat' : null,
      commit_block: committed.get(uid)?.commit_block ?? null,
      uid,
      hotkey: n.hotkey?.ss58 ?? null,
      coldkey: n.coldkey?.ss58 ?? null,
      active: n.active,
      validator: Boolean(n.validator_permit),
      stake: n.total_alpha_stake,
      incentive: Number(n.incentive ?? 0),
      emission: n.emission,
      daily_reward: n.daily_reward,
      trust: Number(n.trust ?? 0),
      updated: n.updated,
      immunity: n.is_immunity_period,
      registered_at: n.registered_at_block,
      // round-derived
      gen_ref: f?.gen_ref ?? h?.gen_ref ?? committed.get(uid)?.gen_ref ?? null,
      role: f?.role ?? null,
      heat_rank: h?.rank ?? null,
      heat_crps: h?.crps ?? null,
      heat_mase: h?.mase ?? null,
      p_best: h?.p_best ?? null,
      advanced: h?.status === 'advanced',
      committed: committed.has(uid),
      weight: weights.get(uid) ?? 0,
      mase_mean: summaries.get(uid)?.mase_mean ?? null,
    };
  });
}

/**
 * Marks whether the scores on a row were certified by validators. `certified`
 * counts how many of the round's validators signed off, so "verified 3/3" says
 * three independent validators re-scored and agreed to publish it.
 */
function verifiedCell(r, certified, receipts) {
  if (r.verified === 'final') {
    const n = certified != null && receipts != null ? ` ${certified}/${receipts}` : '';
    return `<span class="badge good" title="Scored in the final duel and published inside validator-signed receipts${
      receipts ? ` — certified by ${certified} of ${receipts} validators` : ''
    }">✓ verified${n}</span>`;
  }
  if (r.verified === 'heat') {
    return `<span class="badge plain" title="Heat screening values come from the trainer's unsigned, single-writer heat mirror. They are excluded from the receipt's signed body, so no validator has certified them.">◷ unverified</span>`;
  }
  return '<span class="dim tiny">—</span>';
}

/** Submission time, derived from the on-chain commit block against a reference height. */
function submittedCell(r, refBlock, blockTimeS) {
  if (r.commit_block == null) return '<span class="dim tiny">—</span>';
  const ago =
    refBlock != null ? `<span class="dim tiny"> ~${fmtDuration(Math.max(0, (refBlock - r.commit_block) * blockTimeS))} ago</span>` : '';
  return `<span class="num">${fmtNum(r.commit_block)}</span>${ago}`;
}

function stage(r) {
  if (r.role === 'king') return '<span class="badge good">king</span>';
  if (r.role === 'challenger') return '<span class="badge"><span class="dot" style="background:var(--series-2)"></span>finalist</span>';
  if (r.advanced) return '<span class="badge plain">advanced</span>';
  if (r.heat_rank != null) return `<span class="badge plain">heat #${r.heat_rank}</span>`;
  if (r.committed) return '<span class="dim tiny">committed</span>';
  return '<span class="dim tiny">—</span>';
}

function render() {
  const q = document.getElementById('fSearch').value.trim().toLowerCase();
  const scope = document.getElementById('fScope').value;
  const sort = document.getElementById('fSort').value;

  let list = rows.filter((r) => {
    if (scope === 'validators' && !r.validator) return false;
    if (scope === 'miners' && r.validator) return false;
    if (scope === 'competing' && r.heat_rank == null) return false;
    if (scope === 'rewarded' && !(r.weight > 0)) return false;
    if (q && !`${r.uid} ${r.hotkey ?? ''} ${r.gen_ref ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  // Kings skip the heat and heat entrants may earn nothing yet, so neither score
  // nor incentive alone orders this table usefully. "Round" walks the pipeline:
  // king, finalists, heat by rank, then everyone else by what they earn.
  const roundRank = (r) => {
    if (r.role === 'king') return [0, 0];
    if (r.role === 'challenger') return [1, r.heat_rank ?? 0];
    if (r.heat_rank != null) return [2, r.heat_rank];
    if (r.committed) return [3, -r.incentive];
    return [4, -r.incentive];
  };

  const cmp = {
    round: (a, b) => {
      const [ag, ai] = roundRank(a);
      const [bg, bi] = roundRank(b);
      return ag !== bg ? ag - bg : ai - bi;
    },
    incentive: (a, b) => b.incentive - a.incentive,
    emission: (a, b) => Number(b.emission) - Number(a.emission),
    stake: (a, b) => Number(b.stake) - Number(a.stake),
    heat: (a, b) => (a.heat_rank ?? 1e9) - (b.heat_rank ?? 1e9),
    weight: (a, b) => b.weight - a.weight,
    uid: (a, b) => a.uid - b.uid,
  }[sort];
  list = [...list].sort(cmp);

  const maxIncentive = Math.max(...rows.map((r) => r.incentive), 1e-9);
  const maxPBest = Math.max(...rows.map((r) => r.p_best ?? 0), 1e-9);
  const { refBlock, blockTimeS, certified, receipts } = tableMeta;

  document.getElementById('lbBody').innerHTML = list.length
    ? list
        .map(
          (r) => `<tr class="${r.role === 'king' ? 'is-king' : ''}">
            <td><strong>${r.uid}</strong></td>
            <td class="mono" title="${esc(r.hotkey ?? '')}">${esc(shortAddr(r.hotkey))}</td>
            <td>${stage(r)}</td>
            <td class="mono tiny" title="${esc(r.gen_ref ?? '')}">${esc(shortGenRef(r.gen_ref))}</td>
            <td>${submittedCell(r, refBlock, blockTimeS)}</td>
            <td class="num">${r.heat_rank ?? '<span class="dim">—</span>'}</td>
            <td class="num">${fmtFixed(r.heat_crps, 6)}</td>
            <td class="num">${fmtFixed(r.heat_mase, 5)}</td>
            <td>${
              r.p_best != null
                ? barCell(r.p_best, maxPBest, { label: fmtPct(r.p_best, 2), color: 'var(--series-3)' })
                : '<span class="dim">—</span>'
            }</td>
            <td>${verifiedCell(r, certified, receipts)}</td>
            <td>${
              r.weight > 0 ? `<span class="badge good">${fmtFixed(r.weight, 4)}</span>` : '<span class="dim">—</span>'
            }</td>
            <td>${barCell(r.incentive, maxIncentive, { label: fmtFixed(r.incentive, 5) })}</td>
            <td class="num">${fmtRao(r.emission, 4)}</td>
            <td class="num">${fmtRao(r.daily_reward, 3)}</td>
            <td class="num">${fmtRao(r.stake, 1)}</td>
            <td>${
              r.validator
                ? '<span class="badge plain">validator</span>'
                : r.active
                ? '<span class="badge good">● active</span>'
                : '<span class="badge critical">○ inactive</span>'
            }${r.immunity ? ' <span class="badge warning">immune</span>' : ''}</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="16" class="empty">No miners match these filters.</td></tr>`;

  document.getElementById('lbCount').textContent = `${list.length} of ${rows.length}`;
}

async function load() {
  try {
    const [mgRes, latestRes] = await Promise.allSettled([
      fetchJSON('/api/metagraph'),
      fetchJSON('/api/cascade/latest'),
    ]);

    const stale = [];
    const missing = [];
    const neurons = mgRes.status === 'fulfilled' ? mgRes.value.data : [];
    if (mgRes.status === 'fulfilled') {
      if (mgRes.value.stale) stale.push('metagraph');
    } else {
      missing.push('metagraph');
    }

    let detail = null;
    let round = null;
    if (latestRes.status === 'fulfilled' && latestRes.value.round) {
      round = latestRes.value.round;
      try {
        const d = await fetchJSON(`/api/cascade/round/${encodeURIComponent(round.round_id)}`);
        detail = d.detail;
      } catch {
        missing.push('round scores');
      }
    } else {
      missing.push('rounds');
    }

    rows = buildRows(neurons, detail);

    // Prefer the metagraph's own block height (freshest, already fetched) over
    // the receipt index snapshot, which lags by however long ago it published.
    tableMeta = {
      refBlock: neurons[0]?.block_number ?? latestRes.value?.chain?.current_block ?? null,
      blockTimeS: latestRes.value?.chain?.block_time_s ?? 12,
      certified: round?.n_scored ?? null,
      receipts: round?.n_receipts ?? null,
    };

    const competing = rows.filter((r) => r.heat_rank != null).length;
    const rewarded = rows.filter((r) => r.weight > 0).length;

    document.getElementById('summary').innerHTML = `
      <div class="stat-grid">
        <div class="stat-tile"><div class="stat-label">Registered</div><div class="stat-value">${fmtNum(
          rows.length
        )}</div><div class="stat-sub">neurons on SN91</div></div>
        <div class="stat-tile"><div class="stat-label">Committed</div><div class="stat-value">${fmtNum(
          detail?.participants?.length
        )}</div><div class="stat-sub">generators last round</div></div>
        <div class="stat-tile"><div class="stat-label">In the heat</div><div class="stat-value">${fmtNum(
          competing
        )}</div><div class="stat-sub">screened last round</div></div>
        <div class="stat-tile"><div class="stat-label">Finalists</div><div class="stat-value">${fmtNum(
          detail?.entries?.length
        )}</div><div class="stat-sub">reached full training</div></div>
        <div class="stat-tile"><div class="stat-label">Earning weight</div><div class="stat-value">${fmtNum(
          rewarded
        )}</div><div class="stat-sub">king + prior kings</div></div>
      </div>`;

    document.getElementById('leaderboard').innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h2>Miner leaderboard</h2>
          <div class="filters">
            <input id="fSearch" type="search" placeholder="uid, hotkey, generator…" />
            <select id="fScope">
              <option value="">Everyone</option>
              <option value="competing">Competed last round</option>
              <option value="rewarded">Earning weight</option>
              <option value="miners">Miners only</option>
              <option value="validators">Validators only</option>
            </select>
            <select id="fSort">
              <option value="round">Sort: round standing</option>
              <option value="incentive">Sort: incentive</option>
              <option value="weight">Sort: round weight</option>
              <option value="heat">Sort: heat rank</option>
              <option value="emission">Sort: emission</option>
              <option value="stake">Sort: stake</option>
              <option value="uid">Sort: uid</option>
            </select>
            <span id="lbCount" class="dim small" style="align-self:center"></span>
          </div>
        </div>
        <p class="panel-note">
          Chain position joined to last round's scores${
            round ? ` (round ${fmtNum(round.epoch_start_block)})` : ''
          }. <strong>CRPS</strong> and <strong>MASE</strong> are from the heat screen — lower is better.
          <strong>p(best)</strong> is the bootstrap probability that entrant was genuinely the field's best.
          <strong>Incentive</strong> and <strong>emission</strong> are the on-chain consequences.
          <strong>Submitted</strong> is the block the generator was committed on-chain.
          <strong>Verified</strong> separates scores validators actually certified in a signed receipt from
          heat-screen values, which the trainer publishes unsigned and no validator attests to.
        </p>
        <div class="table-wrap scroll-cap">
          <table class="data-table">
            <thead><tr>
              <th>UID</th><th>Hotkey</th><th>Stage</th><th>Generator</th><th>Submitted</th>
              <th>Heat rank</th><th>CRPS</th><th>MASE</th><th>p(best)</th><th>Verified</th>
              <th>Round weight</th><th>Incentive</th><th>Emission (α)</th><th>Daily (α)</th><th>Stake (α)</th><th>Status</th>
            </tr></thead>
            <tbody id="lbBody"></tbody>
          </table>
        </div>
      </div>`;

    for (const id of ['fSearch', 'fScope', 'fSort']) {
      document.getElementById(id).addEventListener('input', render);
    }
    render();

    const [rewardState, chainState] = await Promise.all([mountRewards(), mountChain()]);
    setStatus({
      stale: [...stale, ...(rewardState?.stale ?? []), ...(chainState?.stale ?? [])],
      missing: [...missing, ...(rewardState?.missing ?? []), ...(chainState?.missing ?? [])],
    });
    markUpdated();
  } catch (err) {
    showError(document.getElementById('main'), err);
  }
}

load();
