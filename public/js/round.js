import {
  mountChrome,
  setStatus,
  markUpdated,
  fetchJSON,
  esc,
  fmtNum,
  fmtFixed,
  fmtPct,
  shortAddr,
  shortGenRef,
  shortDigest,
  statusBadge,
  roleBadge,
  timeAgo,
  fmtDateTime,
  divergingBar,
  barCell,
  histogramFacet,
  showError,
  ROLE_COLOR,
  setTopbarTitle,
  checkCredits,
} from './common.js';

mountChrome({ active: '/rounds' });
checkCredits();

const roundId = new URLSearchParams(window.location.search).get('id');

function renderHeader(round, d, epochBlocks) {
  document.getElementById('header').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Round ${esc(round.epoch_start_block)} <span class="dim mono small">${esc(round.round_id)}</span></h2>
        ${statusBadge(d.status, d.reject_reason)}
      </div>
      <div class="cols-2">
        <dl class="kv">
          <dt>Epoch blocks</dt><dd class="num">${fmtNum(d.epoch_start_block)} → ${fmtNum(
    d.epoch_start_block + epochBlocks
  )}</dd>
          <dt>Manifest created</dt><dd class="num">block ${fmtNum(d.manifest.created_block)}</dd>
          <dt>Published</dt><dd>${fmtDateTime(round.published_at)} <span class="dim">(${timeAgo(
    round.published_at
  )})</span></dd>
          <dt>Scored by</dt><dd>${d.n_scored ?? round.n_scored} of ${round.n_receipts} validators</dd>
          <dt>Eval dataset</dt><dd class="mono">${esc(d.manifest.eval_dataset ?? '—')}</dd>
        </dl>
        <dl class="kv">
          <dt>Eval windows</dt><dd class="num">${fmtNum(d.eval_context.n_windows)} windows · ${fmtNum(
    round.n_clusters
  )} clusters</dd>
          <dt>Forecast samples</dt><dd class="num">${fmtNum(d.eval_context.num_samples)} per window</dd>
          <dt>Model size</dt><dd class="mono">${esc(d.manifest.warm_start_size ?? '—')}</dd>
          <dt>Warm start</dt><dd>${round.warm_start ? 'yes — trained from promoted checkpoint' : 'no — from scratch'}</dd>
          <dt>Epoch block hash</dt><dd class="digest">${esc(shortDigest(d.epoch_block_hash, 16))}</dd>
        </dl>
      </div>
    </div>`;
}

function renderVerdict(round, d) {
  const v = d.verdict;
  if (!v) {
    document.getElementById('verdict').innerHTML = `
      <div class="panel">
        <div class="panel-header"><h2>Verdict</h2></div>
        <div class="empty">This round was ${esc(d.status)}${
      d.reject_reason ? ` — ${esc(d.reject_reason)}` : ''
    }, so no verdict was produced.</div>
      </div>`;
    return;
  }

  const cohort = Object.entries(v.cohort_lcbs ?? {});
  const domains = Object.entries(round.per_domain_win_rate ?? {});

  document.getElementById('verdict').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>King-of-the-hill verdict</h2>
        ${
          v.dethroned
            ? '<span class="badge critical">✕ king dethroned</span>'
            : '<span class="badge good">✓ king held the crown</span>'
        }
      </div>
      <p class="panel-note">
        The challenger's advantage over the king is bootstrapped across evaluation windows
        (B=${fmtNum(v.params?.bootstrap_B)}, α=${fmtFixed(v.params?.bootstrap_alpha, 2)}). The crown only changes hands
        if the <strong>lower confidence bound</strong> of that advantage clears the <strong>win margin</strong>,
        which decays as the king's tenure grows.
      </p>

      <div class="stat-grid">
        <div class="stat-tile"><div class="stat-label">King geomean</div><div class="stat-value">${fmtFixed(
          v.king_geomean,
          5
        )}</div><div class="stat-sub">uid ${esc(v.king_uid)} · tenure ${fmtNum(v.king_tenure_rounds)}</div></div>
        <div class="stat-tile"><div class="stat-label">Challenger geomean</div><div class="stat-value">${fmtFixed(
          v.chal_geomean,
          5
        )}</div><div class="stat-sub">uid ${esc(round.chal_uid ?? '—')}</div></div>
        <div class="stat-tile"><div class="stat-label">LCB</div><div class="stat-value">${fmtFixed(
          v.lcb,
          5
        )}</div><div class="stat-sub">95% lower bound on the gain</div></div>
        <div class="stat-tile"><div class="stat-label">Win margin</div><div class="stat-value">${fmtFixed(
          v.margin,
          5
        )}</div><div class="stat-sub">threshold to dethrone</div></div>
        <div class="stat-tile"><div class="stat-label">Bootstrap p50 / p95</div><div class="stat-value">${fmtFixed(
          v.boot_p50,
          4
        )}</div><div class="stat-sub">p95 ${fmtFixed(v.boot_p95, 4)}</div></div>
        <div class="stat-tile"><div class="stat-label">Baseline geomean</div><div class="stat-value">${fmtFixed(
          v.init_baseline_geomean,
          5
        )}</div><div class="stat-sub">init floor ${v.init_floor_passed ? 'passed' : 'failed'}</div></div>
      </div>

      <div class="cols-2">
        <div>
          <div class="panel-header"><h2>Challenger cohort</h2></div>
          <p class="panel-note">Every finalist is bootstrapped against the king; the best LCB is the one that
            faces the margin. Cohort α is Bonferroni-split across ${fmtNum(v.cohort_k)} challengers.</p>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Hotkey</th><th>LCB</th><th>vs margin</th></tr></thead>
              <tbody>
                ${
                  cohort.length
                    ? cohort
                        .sort((a, b) => b[1] - a[1])
                        .map(
                          ([hk, lcb]) => `<tr>
                            <td class="mono" title="${esc(hk)}">${esc(shortAddr(hk))}</td>
                            <td class="num">${fmtFixed(lcb, 6)}</td>
                            <td>${
                              lcb > v.margin
                                ? '<span class="badge good">cleared</span>'
                                : '<span class="badge plain">short by ' + fmtFixed(v.margin - lcb, 5) + '</span>'
                            }</td>
                          </tr>`
                        )
                        .join('')
                    : '<tr><td colspan="3" class="empty">No cohort recorded.</td></tr>'
                }
              </tbody>
            </table>
          </div>
          <dl class="kv" style="margin-top:12px">
            <dt>Wilcoxon p</dt><dd class="num">${fmtFixed(round.wilcoxon_p, 4)}</dd>
            <dt>Window win rate</dt><dd>${divergingBar(round.win_rate)}</dd>
            <dt>Inconclusive</dt><dd>${v.inconclusive ? 'yes' : 'no'}</dd>
            <dt>Margin warmup</dt><dd>${fmtNum(v.params?.margin_warmup_rounds)} rounds · floor ${fmtFixed(
    v.params?.win_margin_end,
    4
  )}</dd>
          </dl>
        </div>

        <div>
          <div class="panel-header"><h2>Win rate by domain</h2></div>
          <p class="panel-note">Share of that domain's windows the challenger beat the king on.
            Above 50% (blue) favours the challenger; below (red) favours the king.</p>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Domain</th><th>Win rate</th><th>Windows</th></tr></thead>
              <tbody>
                ${
                  domains.length
                    ? domains
                        .sort((a, b) => b[1][0] - a[1][0])
                        .map(
                          ([name, [rate, n]]) => `<tr>
                            <td>${esc(name)}</td>
                            <td>${divergingBar(rate)}</td>
                            <td class="num dim">${fmtNum(n)}</td>
                          </tr>`
                        )
                        .join('')
                    : '<tr><td colspan="3" class="empty">No per-domain breakdown.</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function renderHeat(d) {
  const heat = d.heat;
  const el = document.getElementById('heat');
  if (!heat?.entrants?.length) {
    el.innerHTML = `<div class="panel"><div class="panel-header"><h2>Heat phase</h2></div>
      <div class="empty">No heat standings published for this round.</div></div>`;
    return;
  }

  const entrants = [...heat.entrants].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const advanced = entrants.filter((e) => e.status === 'advanced').length;
  const bestP = Math.max(...entrants.map((e) => e.p_best ?? 0), 0.0001);

  el.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Heat phase — screening</h2>
        <span class="dim small">${entrants.length} entrants · ${advanced} advanced · screen size ${esc(
    heat.screen_size ?? '—'
  )}</span>
      </div>
      <p class="panel-note">
        Every committed generator trains a short, reduced-size run first. Entrants are ranked by
        CRPS, and <strong>p(best)</strong> is the bootstrap probability that entrant is genuinely the best
        of the field. Only the top finishers advance to the full-length final against the king.
      </p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Rank</th><th>UID</th><th>Hotkey</th><th>Generator</th>
            <th>CRPS</th><th>MASE</th><th>p(best)</th><th>Rel. score</th><th>Outcome</th>
          </tr></thead>
          <tbody>
            ${entrants
              .map(
                (e) => `<tr class="${e.status === 'advanced' ? 'is-king' : ''}">
                  <td class="num">${esc(e.rank ?? '—')}</td>
                  <td><strong>${esc(e.uid)}</strong></td>
                  <td class="mono" title="${esc(e.hotkey ?? '')}">${esc(shortAddr(e.hotkey))}</td>
                  <td class="mono tiny">${esc(shortGenRef(e.gen_ref))}</td>
                  <td class="num">${fmtFixed(e.crps, 6)}</td>
                  <td class="num">${fmtFixed(e.mase, 5)}</td>
                  <td>${barCell(e.p_best, bestP, { label: fmtPct(e.p_best, 2), color: 'var(--series-3)' })}</td>
                  <td class="num">${fmtFixed(e.rel_score, 5)}</td>
                  <td>${
                    e.status === 'advanced'
                      ? '<span class="badge good">✓ advanced</span>'
                      : `<span class="badge plain">○ ${esc(e.status ?? 'screened')}</span>`
                  }</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderFinals(d) {
  const summaries = d.entry_summaries ?? [];
  const entries = d.entries ?? [];
  const h2h = new Map((d.head_to_head ?? []).map((h) => [h.uid, h]));
  const byUid = new Map(entries.map((e) => [e.miner_uid, e]));

  const el = document.getElementById('finals');
  if (!summaries.length) {
    el.innerHTML = `<div class="panel"><div class="panel-header"><h2>Final phase</h2></div>
      <div class="empty">No per-window scores in this receipt.</div></div>`;
    return;
  }

  const order = { king: 0, challenger: 1, baseline: 2 };
  const sorted = [...summaries].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));

  el.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Final phase — full training run</h2>
        <span class="dim small">${fmtNum(d.eval_context.n_windows)} evaluation windows per entrant</span>
      </div>
      <p class="panel-note">
        Finalists and the king train the identical model on their own generated corpus, then forecast the same
        held-out windows. <strong>MASE</strong> and normalised quantile loss are descriptive statistics recomputed
        from the published per-window scores; the official decision uses the geomean above.
        <strong>Beats king</strong> is the share of windows where that entrant's MASE came in below the king's.
      </p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Role</th><th>UID</th><th>Hotkey</th><th>Generator</th>
            <th>MASE mean</th><th>MASE median</th><th>p10 – p90</th><th>Norm. q-loss</th>
            <th>Beats king</th><th>GPU</th>
          </tr></thead>
          <tbody>
            ${sorted
              .map((s) => {
                const entry = byUid.get(s.uid);
                const hh = h2h.get(s.uid);
                return `<tr class="${s.role === 'king' ? 'is-king' : ''}">
                  <td>${roleBadge(s.role)}</td>
                  <td><strong>${esc(s.uid === -1 ? '—' : s.uid)}</strong></td>
                  <td class="mono" title="${esc(s.hotkey ?? '')}">${esc(shortAddr(s.hotkey))}</td>
                  <td class="mono tiny">${esc(shortGenRef(entry?.gen_ref))}</td>
                  <td class="num">${fmtFixed(s.mase_mean, 5)}</td>
                  <td class="num">${fmtFixed(s.mase_median, 5)}</td>
                  <td class="num dim">${fmtFixed(s.mase_p10, 3)} – ${fmtFixed(s.mase_p90, 3)}</td>
                  <td class="num">${fmtFixed(s.nqloss_mean, 6)}</td>
                  <td>${hh ? divergingBar(hh.win_rate) : '<span class="dim">king</span>'}</td>
                  <td class="dim tiny">${esc(entry?.gpu_name ?? '—')}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>

      <div class="panel-header" style="margin-top:20px"><h2>Per-window MASE distribution</h2></div>
      <p class="panel-note">One panel per entrant, same axis range, right tail clipped at p98.
        A better generator shifts mass to the left.</p>
      <div class="facet-grid">
        ${sorted
          .map((s) =>
            histogramFacet(s.hist, {
              color: ROLE_COLOR[s.role] ?? 'var(--series-1)',
              title: `<span class="dot" style="background:${ROLE_COLOR[s.role] ?? 'var(--series-1)'}"></span>${esc(
                s.role
              )}${s.uid === -1 ? '' : ` · uid ${esc(s.uid)}`}`,
            })
          )
          .join('')}
      </div>

      <div class="panel-header" style="margin-top:20px"><h2>Submitted artifacts</h2></div>
      <p class="panel-note">Each finalist's generator and the corpus it produced are content-addressed, so anyone
        can refetch the exact bytes the validator scored.</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Role</th><th>UID</th><th>Generator ref</th><th>Corpus digest</th><th>Trained checkpoint</th><th>Train block</th></tr></thead>
          <tbody>
            ${entries
              .map(
                (e) => `<tr>
                  <td>${roleBadge(e.role)}</td>
                  <td>${esc(e.miner_uid)}</td>
                  <td class="digest" title="${esc(e.gen_ref ?? '')}">${esc(shortGenRef(e.gen_ref))}</td>
                  <td class="digest">${esc(shortDigest(e.corpus_digest))}</td>
                  <td class="digest" title="${esc(e.trained_pointer ?? '')}">${esc(
                  shortDigest(e.trained_pointer, 28)
                )}</td>
                  <td class="num">${fmtNum(e.train_block)}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderRewards(d) {
  const weights = d.weights ?? [];
  const total = weights.reduce((a, w) => a + w.weight, 0) || 1;
  const max = Math.max(...weights.map((w) => w.weight), 0.0001);

  document.getElementById('rewards').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Weight vector</h2>
        <span class="dim small">${weights.length} uids rewarded</span>
      </div>
      <p class="panel-note">
        Emission is split down the reign chain: the current king takes the largest share and each prior king
        receives a geometrically decaying slice, so a dethroned generator keeps earning as it ages out.
      </p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>UID</th><th>Weight</th><th>Share</th></tr></thead>
          <tbody>
            ${
              weights.length
                ? weights
                    .map(
                      (w, i) => `<tr class="${i === 0 ? 'is-king' : ''}">
                        <td><strong>${esc(w.uid)}</strong>${
                        i === 0 ? ' <span class="badge good">king</span>' : ''
                      }</td>
                        <td>${barCell(w.weight, max, { label: fmtFixed(w.weight, 4) })}</td>
                        <td class="num">${fmtPct(w.weight / total, 1)}</td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="3" class="empty">No weights set for this round.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderParticipants(d) {
  const ps = d.participants ?? [];
  const finalists = new Set((d.entries ?? []).map((e) => e.miner_uid));
  const heatUids = new Set((d.heat?.entrants ?? []).map((e) => e.uid));

  document.getElementById('participants').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Committed miners</h2>
        <div class="filters">
          <input id="pSearch" type="search" placeholder="uid or hotkey…" />
          <span class="dim small" style="align-self:center">${ps.length} commitments</span>
        </div>
      </div>
      <p class="panel-note">
        Every miner that revealed an on-chain generator pointer before the epoch deadline. Only those
        that cleared the heat appear in the final phase.
      </p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>UID</th><th>Hotkey</th><th>Generator ref</th><th>Commit block</th><th>Stage reached</th></tr></thead>
          <tbody id="pBody"></tbody>
        </table>
      </div>
    </div>`;

  const render = () => {
    const q = document.getElementById('pSearch').value.trim().toLowerCase();
    const rows = ps
      .filter((p) => !q || `${p.uid} ${p.hotkey ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.uid - b.uid);
    document.getElementById('pBody').innerHTML = rows.length
      ? rows
          .map(
            (p) => `<tr>
              <td>${esc(p.uid)}</td>
              <td class="mono" title="${esc(p.hotkey ?? '')}">${esc(shortAddr(p.hotkey))}</td>
              <td class="mono tiny" title="${esc(p.gen_ref ?? '')}">${esc(shortGenRef(p.gen_ref))}</td>
              <td class="num">${fmtNum(p.commit_block)}</td>
              <td>${
                finalists.has(p.uid)
                  ? '<span class="badge good">final</span>'
                  : heatUids.has(p.uid)
                  ? '<span class="badge plain">heat</span>'
                  : '<span class="dim tiny">committed</span>'
              }</td>
            </tr>`
          )
          .join('')
      : `<tr><td colspan="5" class="empty">No commitments match.</td></tr>`;
  };

  document.getElementById('pSearch').addEventListener('input', render);
  render();
}

async function load() {
  if (!roundId) {
    showError(document.getElementById('main'), new Error('No round id given'));
    return;
  }
  try {
    const { round, detail, epoch_blocks, stale } = await fetchJSON(`/api/cascade/round/${encodeURIComponent(roundId)}`);
    document.title = `Round ${round.epoch_start_block} · Cascade SN91`;
    setTopbarTitle(`Round ${fmtNum(round.epoch_start_block)}`);
    renderHeader(round, detail, epoch_blocks);
    renderVerdict(round, detail);
    renderHeat(detail);
    renderFinals(detail);
    renderRewards(detail);
    renderParticipants(detail);
    setStatus({ stale: stale ? ['round'] : [] });
    markUpdated();
  } catch (err) {
    showError(document.getElementById('main'), err);
  }
}

load();
