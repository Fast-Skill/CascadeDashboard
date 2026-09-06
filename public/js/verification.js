import {
  mountChrome,
  setStatus,
  markUpdated,
  fetchJSON,
  esc,
  fmtNum,
  fmtPct,
  shortAddr,
  shortDigest,
  statusBadge,
  timeAgo,
  showError,
  checkCredits,
} from './common.js';

mountChrome();
checkCredits();

const RECEIPTS_BASE = 'https://s3.hippius.com/cascade-manifests';

let rounds = [];

function renderExplain() {
  document.getElementById('explain').innerHTML = `
    <div class="panel">
      <div class="panel-header"><h2>How a round is verified</h2></div>
      <p class="panel-note" style="max-width:96ch">
        Miners never hand a validator a model — they hand it a <strong>content-addressed generator</strong>
        committed on-chain before the epoch deadline. The trainer builds a corpus from it, trains a
        byte-identical model, and every validator independently re-runs the scoring and publishes a
        <strong>signed receipt</strong> to public storage. Because each step is pinned by digest and each
        receipt is public, anyone can refetch the exact inputs and recompute the verdict — that is what
        makes the result auditable rather than merely reported.
      </p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Stage</th><th>What is pinned</th><th>What it prevents</th></tr></thead>
          <tbody>
            <tr><td>Commit</td><td class="wrap">Generator ref <span class="mono tiny">repo@sha256:…</span> revealed on-chain before the epoch boundary</td><td class="wrap">Swapping in a different generator after seeing the eval data</td></tr>
            <tr><td>Contract</td><td class="wrap"><span class="mono tiny">contract_digest</span> over training hyperparameters and architecture</td><td class="wrap">A miner training a different or larger model than everyone else</td></tr>
            <tr><td>Corpus</td><td class="wrap"><span class="mono tiny">corpus_digest</span> of the generated training data</td><td class="wrap">Claiming a score produced by data other than what was published</td></tr>
            <tr><td>Eval pool</td><td class="wrap"><span class="mono tiny">eval_pool_sha256</span> of the held-out window snapshot</td><td class="wrap">Scoring against a pool chosen to flatter one entrant</td></tr>
            <tr><td>Determinism</td><td class="wrap">Generation, training and bootstrap seeds recorded in the receipt</td><td class="wrap">Unreproducible results that cannot be independently re-derived</td></tr>
            <tr><td>Signature</td><td class="wrap">Receipt signed by the validator hotkey</td><td class="wrap">Forged or tampered receipts attributed to a validator</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderSummary() {
  const receipts = rounds.flatMap((r) => r.receipts);
  const rejected = receipts.filter((r) => r.status === 'rejected');
  const validators = new Map();
  for (const r of receipts) {
    const v = validators.get(r.validator_hotkey) ?? { total: 0, scored: 0, rejected: 0 };
    v.total += 1;
    if (r.status === 'scored') v.scored += 1;
    if (r.status === 'rejected') v.rejected += 1;
    validators.set(r.validator_hotkey, v);
  }

  const reasons = new Map();
  for (const r of rejected) {
    // Digest mismatches embed the two hashes; group by the reason, not the values.
    const key = String(r.reject_reason ?? 'unknown').split(':')[0];
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  const disagree = rounds.filter((r) => r.validators_disagree).length;

  document.getElementById('summary').innerHTML = `
    <div class="stat-grid">
      <div class="stat-tile"><div class="stat-label">Receipts published</div><div class="stat-value">${fmtNum(
        receipts.length
      )}</div><div class="stat-sub">across ${fmtNum(rounds.length)} rounds</div></div>
      <div class="stat-tile"><div class="stat-label">Accepted</div><div class="stat-value">${fmtNum(
        receipts.length - rejected.length
      )}</div><div class="stat-sub">${fmtPct((receipts.length - rejected.length) / (receipts.length || 1), 1)} of receipts</div></div>
      <div class="stat-tile"><div class="stat-label">Rejected</div><div class="stat-value">${fmtNum(
        rejected.length
      )}</div><div class="stat-sub">failed a gate</div></div>
      <div class="stat-tile"><div class="stat-label">Validators publishing</div><div class="stat-value">${fmtNum(
        validators.size
      )}</div><div class="stat-sub">independent signers</div></div>
      <div class="stat-tile"><div class="stat-label">Rounds in dispute</div><div class="stat-value">${fmtNum(
        disagree
      )}</div><div class="stat-sub">scored validators disagreed</div></div>
    </div>

    <div class="cols-2">
      <div class="panel">
        <div class="panel-header"><h2>Validator publishing record</h2></div>
        <p class="panel-note">Each validator scores every round independently. A validator that rejects a round
          the others accepted is refusing to certify it, not failing.</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Validator hotkey</th><th>Receipts</th><th>Scored</th><th>Rejected</th></tr></thead>
            <tbody>
              ${[...validators.entries()]
                .sort((a, b) => b[1].total - a[1].total)
                .map(
                  ([hk, v]) => `<tr>
                    <td class="mono" title="${esc(hk)}">${esc(shortAddr(hk, 8, 8))}</td>
                    <td class="num">${v.total}</td>
                    <td class="num">${v.scored}</td>
                    <td class="num">${
                      v.rejected ? `<span class="badge critical">${v.rejected}</span>` : '0'
                    }</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h2>Why receipts get rejected</h2></div>
        <p class="panel-note">A rejected receipt means the validator could not verify the round's inputs,
          so it declined to score it and set no weights from it.</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Gate that failed</th><th>Receipts</th></tr></thead>
            <tbody>
              ${
                reasons.size
                  ? [...reasons.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(
                        ([reason, n]) =>
                          `<tr><td class="mono tiny">${esc(reason)}</td><td class="num">${n}</td></tr>`
                      )
                      .join('')
                  : '<tr><td colspan="2" class="empty">No rejections recorded.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function renderReceipts() {
  const onlyProblems = document.getElementById('fProblems')?.checked;
  const q = document.getElementById('fSearch')?.value.trim().toLowerCase() ?? '';

  const list = rounds.filter((r) => {
    if (onlyProblems && !r.validators_disagree && r.n_rejected === 0) return false;
    if (q && !`${r.round_id} ${r.epoch_start_block}`.toLowerCase().includes(q)) return false;
    return true;
  });

  document.getElementById('rcBody').innerHTML = list.length
    ? list
        .flatMap((r) =>
          r.receipts.map(
            (rc, i) => `<tr>
              ${
                i === 0
                  ? `<td class="num" rowspan="${r.receipts.length}">
                       <a href="/round?id=${encodeURIComponent(r.round_id)}">${fmtNum(r.epoch_start_block)}</a>
                       ${r.validators_disagree ? '<br><span class="badge warning">⚠ disagree</span>' : ''}
                     </td>`
                  : ''
              }
              <td class="mono" title="${esc(rc.validator_hotkey ?? '')}">${esc(shortAddr(rc.validator_hotkey))}</td>
              <td>${statusBadge(rc.status, rc.reject_reason)}</td>
              <td>${rc.post_round_king_uid != null ? `uid ${rc.post_round_king_uid}` : '<span class="dim">—</span>'}</td>
              <td>${
                rc.dethroned === true
                  ? '<span class="badge critical">dethroned</span>'
                  : rc.dethroned === false
                  ? '<span class="badge plain">held</span>'
                  : '<span class="dim">—</span>'
              }</td>
              <td class="num">${rc.n_rewarded ?? 0}</td>
              <td class="wrap tiny dim">${esc(rc.reject_reason ?? '')}</td>
              <td class="dim">${timeAgo(rc.published_at)}</td>
              <td><a class="tiny mono" href="${RECEIPTS_BASE}/${esc(
              rc.receipt_key
            )}" target="_blank" rel="noopener">raw ↗</a></td>
            </tr>`
          )
        )
        .join('')
    : `<tr><td colspan="9" class="empty">No receipts match.</td></tr>`;

  document.getElementById('rcCount').textContent = `${list.length} rounds`;
}

async function load() {
  try {
    const idx = await fetchJSON('/api/cascade/rounds');
    rounds = idx.rounds ?? [];

    renderExplain();
    renderSummary();

    document.getElementById('receipts').innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h2>Published receipts</h2>
          <div class="filters">
            <input id="fSearch" type="search" placeholder="round id or block…" />
            <label class="small" style="display:flex;align-items:center;gap:6px">
              <input type="checkbox" id="fProblems" /> Only rejections &amp; disputes
            </label>
            <span id="rcCount" class="dim small" style="align-self:center"></span>
          </div>
        </div>
        <p class="panel-note">Every receipt every validator published, grouped by round. Each links to the
          raw signed JSON in public storage, which is the artifact an independent auditor re-derives.</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>Round</th><th>Validator</th><th>Status</th><th>King after</th><th>Result</th>
              <th>Rewarded</th><th>Reject reason</th><th>Published</th><th>Raw</th>
            </tr></thead>
            <tbody id="rcBody"></tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('fSearch').addEventListener('input', renderReceipts);
    document.getElementById('fProblems').addEventListener('change', renderReceipts);
    renderReceipts();

    setStatus({ stale: idx.stale ? ['rounds'] : [] });
    markUpdated();
  } catch (err) {
    showError(document.getElementById('main'), err);
  }
}

load();
