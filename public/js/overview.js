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
  timeAgo,
  epochProgress,
  stepper,
  sparkline,
  ring,
  showError,
} from './common.js';

mountChrome();

const STATE_BADGE = {
  advanced: '<span class="badge good">✓ advanced</span>',
  screened: '<span class="badge plain">○ screened</span>',
  rejected: '<span class="badge critical">✕ rejected</span>',
};

/** Oldest → newest slice of the round history, so sparklines read left-to-right in time. */
function series(rounds, n, pick) {
  return rounds
    .slice(0, n)
    .reverse()
    .map(pick)
    .filter((v) => Number.isFinite(v));
}

function trend(values) {
  if (values.length < 2) return { dir: 'flat', pct: null };
  const first = values[0];
  const last = values[values.length - 1];
  if (!first) return { dir: 'flat', pct: null };
  const pct = ((last - first) / Math.abs(first)) * 100;
  return { dir: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat', pct };
}

function trendLabel(t, { invert = false, digits = 1 } = {}) {
  if (t.pct === null) return '<span class="kpi-trend flat">flat</span>';
  const good = invert ? t.dir === 'down' : t.dir === 'up';
  const cls = t.dir === 'flat' ? 'flat' : good ? 'up' : 'down';
  const arrow = t.dir === 'up' ? '↗' : t.dir === 'down' ? '↘' : '→';
  return `<span class="kpi-trend ${cls}">${arrow} ${Math.abs(t.pct).toFixed(digits)}%</span>`;
}

function kpiCard({ label, value, unit, sub, spark, trendHtml }) {
  return `<div class="kpi-card">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${value}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>
    <div class="kpi-foot">
      ${trendHtml ?? `<span class="kpi-trend flat">${esc(sub ?? '')}</span>`}
      ${spark ? `<span class="kpi-spark">${spark}</span>` : ''}
    </div>
  </div>`;
}

function renderKpis({ live, latest, rewards, subnet, metagraph, roundsHist }) {
  const rounds = roundsHist?.rounds ?? [];
  const reigns = roundsHist?.reigns ?? [];
  const round = latest?.round ?? null;
  const reign = latest?.reign ?? null;
  const top = rewards?.ranks?.[0] ?? null;

  // 1. King geomean — lower is better, so an "up" trend in the number is bad.
  const geomeanSeries = series(rounds, 20, (r) => r.king_geomean);
  const geomeanTrend = trend(geomeanSeries);

  // 2. Network participation — committed generators per round.
  const partSeries = series(rounds, 20, (r) => r.n_participants);
  const partTrend = trend(partSeries);

  // 3. King's share of the reward pool — no time series (weights aren't stored
  //    historically), so this card shows the current split instead of a trend.
  const shareVal = top ? fmtPct(top.share, 1) : '—';

  // 4. Total stake across the subnet, summed from the live metagraph snapshot.
  const totalStakeAlpha = (metagraph ?? []).reduce((a, n) => a + Number(n.total_alpha_stake ?? 0), 0) / 1e9;

  // 5. Reign length — how many rounds the current king has held, vs. past reigns.
  const reignSeries = reigns.slice(-12).map((r) => r.rounds);
  const reignTrend = trend(reignSeries);

  // 6. Validator certification — fraction of receipts scored per round, historically.
  const certSeries = series(rounds, 20, (r) => (r.n_receipts ? r.n_scored / r.n_receipts : null));
  const certNow = live?.validators?.length
    ? live.validators.filter((v) => v.published).length / live.validators.length
    : null;

  // 7. Heat participation this round: what fraction of submissions got screened
  //    at all (the rest were filtered before any compute was spent on them).
  const heatSeries = series(rounds, 20, (r) => r.heat?.n_entrants);
  const submitted = live?.submission_counts?.submitted;
  const screened = live?.submission_counts?.screened;
  const heatFillPct = submitted ? (screened / submitted) * 100 : null;

  const cards = [
    kpiCard({
      label: 'King Geomean',
      value: fmtFixed(round?.king_geomean, 4),
      sub: 'CRPS+MASE loss',
      spark: sparkline(geomeanSeries, { color: 'var(--series-1)' }),
      trendHtml: trendLabel(geomeanTrend, { invert: true, digits: 2 }),
    }),
    kpiCard({
      label: 'Committed Miners',
      value: fmtNum(round?.n_participants),
      sub: 'per round',
      spark: sparkline(partSeries, { color: 'var(--series-3)' }),
      trendHtml: trendLabel(partTrend),
    }),
    kpiCard({
      label: "King's Reward Share",
      value: shareVal,
      unit: '',
      spark: null,
      trendHtml: `<span class="kpi-trend flat">weight ${fmtFixed(top?.weight, 3)}</span>`,
    }),
    kpiCard({
      label: 'Total Stake',
      value: fmtNum(totalStakeAlpha, 0),
      unit: 'α',
      spark: null,
      trendHtml: `<span class="kpi-trend flat">${fmtNum(metagraph?.length)} keys</span>`,
    }),
    kpiCard({
      label: 'Reign Length',
      value: fmtNum(reign?.rounds),
      unit: 'rounds',
      spark: sparkline(reignSeries, { color: 'var(--series-2)' }),
      trendHtml: trendLabel(reignTrend),
    }),
    kpiCard({
      label: 'Validator Certification',
      value: certNow != null ? fmtPct(certNow, 0) : '—',
      sub: 'this round',
      spark: sparkline(certSeries, { color: 'var(--good)' }),
      trendHtml: `<span class="kpi-trend flat">${(live?.validators ?? []).filter((v) => v.published).length}/${
        (live?.validators ?? []).length
      } reported</span>`,
    }),
    kpiCard({
      label: 'Heat Fill Rate',
      value: heatFillPct != null ? fmtPct(heatFillPct / 100, 0) : '—',
      sub: 'screened / submitted',
      spark: sparkline(heatSeries, { color: 'var(--series-4)' }),
      trendHtml: `<span class="kpi-trend flat">${fmtNum(screened)} / ${fmtNum(submitted)}</span>`,
    }),
  ];

  document.getElementById('kpis').innerHTML = `<div class="kpi-grid">${cards.join('')}</div>`;
}

function renderRankings(metagraph, latest) {
  const round = latest?.round;
  const kingUid = round?.king_uid;
  const chalUid = round?.chal_uid;

  const ranked = [...(metagraph ?? [])]
    .filter((n) => !n.validator_permit)
    .sort((a, b) => Number(b.incentive) - Number(a.incentive))
    .slice(0, 8);

  const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null);

  document.getElementById('rankings').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Miner Rankings</h2>
        <a class="small" href="/miners">View all →</a>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Rank</th><th>UID</th><th>Hotkey</th><th>Role</th><th>Incentive</th><th>Emission (α/day)</th></tr></thead>
          <tbody>
            ${!ranked.length ? '<tr><td colspan="6" class="empty">Chain data unavailable — miner rankings need the metagraph.</td></tr>' : ''}
            ${ranked
              .map((n, i) => {
                const m = medal(i);
                const role = n.uid === kingUid ? 'role-king' : n.uid === chalUid ? 'role-challenger' : '';
                return `<tr class="stripe ${role}">
                  <td><span class="rank-cell">${m ? `<span class="rank-medal">${m}</span>` : `#${i + 1}`}</span></td>
                  <td><strong>${esc(n.uid)}</strong></td>
                  <td class="mono" title="${esc(n.hotkey?.ss58 ?? '')}">${esc(shortAddr(n.hotkey?.ss58))}</td>
                  <td>${
                    n.uid === kingUid
                      ? '<span class="badge good">king</span>'
                      : n.uid === chalUid
                      ? '<span class="badge accent">challenger</span>'
                      : '<span class="dim tiny">miner</span>'
                  }</td>
                  <td class="num">${fmtFixed(n.incentive, 4)}</td>
                  <td class="num">${fmtRao(n.daily_reward, 2)}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

let chartRange = 20;
let chartRoundsCache = [];

function lineChart(values, { width = 560, height = 150, color = 'var(--accent)' } = {}) {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return `<div class="empty">Not enough history yet.</div>`;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = 10;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const step = w / (vals.length - 1);
  const pts = vals.map((v, i) => [padL + i * step, padT + (1 - (v - lo) / span) * h]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `${padL},${padT + h} ${line} ${padL + w},${padT + h}`;
  const grid = [0.25, 0.5, 0.75].map((f) => padT + h * f);
  const uid = `lc${Math.random().toString(36).slice(2, 8)}`;
  return `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart-svg-wrap">
    <defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid.map((y) => `<line x1="${padL}" y1="${y}" x2="${padL + w}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`).join('')}
    <polygon points="${area}" fill="url(#${uid})" stroke="none"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3.2" fill="${color}"/>
  </svg>`;
}

function renderPerformance(roundsHist) {
  const all = roundsHist?.rounds ?? [];
  const el = document.getElementById('performance');
  chartRoundsCache = all;

  const draw = () => {
    const window_ = chartRoundsCache.slice(0, chartRange).reverse();
    const vals = window_.map((r) => r.king_geomean).filter((v) => Number.isFinite(v));
    document.getElementById('perfChart').innerHTML = lineChart(vals, { color: 'var(--accent)' });

    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const best = vals.length ? Math.min(...vals) : null;
    const worst = vals.length ? Math.max(...vals) : null;
    const std = vals.length
      ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length)
      : null;

    document.getElementById('perfQuads').innerHTML = `
      <div class="chart-quad"><div class="stat-label">Average</div><div class="stat-value">${fmtFixed(mean, 4)}</div></div>
      <div class="chart-quad"><div class="stat-label">Best (lowest)</div><div class="stat-value">${fmtFixed(best, 4)}</div></div>
      <div class="chart-quad"><div class="stat-label">Worst (highest)</div><div class="stat-value">${fmtFixed(worst, 4)}</div></div>
      <div class="chart-quad"><div class="stat-label">Std Dev</div><div class="stat-value">${fmtFixed(std, 4)}</div></div>`;

    document.querySelectorAll('.chart-tab').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.range) === chartRange);
    });
  };

  el.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>King Geomean — Performance</h2>
        <div class="chart-toolbar">
          <button class="chart-tab" data-range="10" type="button">10 Rounds</button>
          <button class="chart-tab" data-range="20" type="button">20 Rounds</button>
          <button class="chart-tab" data-range="${all.length}" type="button">All (${all.length})</button>
        </div>
      </div>
      <p class="panel-note">The king's combined CRPS + MASE loss at the end of each round. Lower is better —
        a falling line means the reigning generator keeps getting harder to beat.</p>
      <div id="perfChart"></div>
      <div class="chart-quads" id="perfQuads"></div>
    </div>`;

  el.querySelectorAll('.chart-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      chartRange = Number(btn.dataset.range);
      draw();
    });
  });
  draw();
}

function renderVerification(live) {
  // This panel is built around the p(best) ring, so it must lead with entrants
  // that actually have a score. Rejected submissions carry no rank or p(best);
  // sorting on rank alone let them fill the panel with empty rings whenever the
  // heat hasn't screened anything yet.
  const scored = (live?.submissions ?? []).filter((s) => s.state !== 'rejected');
  const subs = [...scored].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, 5);
  const heat = live?.heat;
  const current = heat?.is_current;
  const rejectedOnly = (live?.submissions ?? []).length > 0 && scored.length === 0;

  document.getElementById('verifyList').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Miners Under Verification</h2>
        <span class="badge ${current ? 'good' : 'warning'}">${
    current ? '● this round' : `◷ epoch ${fmtNum(heat?.epoch_start_block)}`
  }</span>
      </div>
      <p class="panel-note">
        Ring shows each entrant's bootstrap <strong>p(best)</strong> — the probability it is genuinely the
        top generator of the field. <a href="/#submissions" onclick="document.getElementById('submissions').scrollIntoView({behavior:'smooth'})">Full list of ${fmtNum(
    live?.submission_counts?.submitted
  )} submissions ↓</a>
      </p>
      <div class="verify-list">
        ${
          subs.length
            ? subs
                .map(
                  (s) => `<div class="verify-item">
                    ${ring((s.p_best ?? 0) * 100, { size: 46, stroke: 5, color: s.state === 'advanced' ? 'var(--good)' : 'var(--accent)', label: s.p_best != null ? Math.round(s.p_best * 100) + '%' : '—' })}
                    <div class="verify-meta">
                      <div class="vm-top">UID ${esc(s.uid ?? '—')} ${STATE_BADGE[s.state] ?? ''}</div>
                      <div class="vm-sub">rank ${s.rank ?? '—'} · CRPS ${
                    s.crps != null ? Number(s.crps).toFixed(6) : '—'
                  }</div>
                      <div class="vm-detail" title="${esc(s.hotkey ?? '')}">${esc(shortAddr(s.hotkey))}</div>
                    </div>
                  </div>`
                )
                .join('')
            : `<div class="verify-item"><div class="empty">${
                rejectedOnly
                  ? `The heat has not screened any generator yet this round — all ${fmtNum(
                      live?.submission_counts?.submitted
                    )} submissions so far were filtered before screening.`
                  : 'No screening results published yet.'
              }</div></div>`
        }
      </div>
    </div>`;
}

function renderPipeline(live, liveBlock) {
  // epochProgress needs the CURRENT chain height, not the epoch's own start
  // block — passing the latter always yields elapsed=0, i.e. a permanent "0%
  // complete" regardless of true progress.
  const p = epochProgress(liveBlock ?? live?.epoch_start_block, live?.epoch_blocks ?? 3600);
  document.getElementById('pipelineCard').innerHTML = `
    <div class="panel">
      <div class="panel-header"><h2>Round Pipeline</h2><span class="badge accent">epoch ${fmtNum(
        live?.epoch_start_block
      )}</span></div>
      ${stepper(live, { vertical: true })}
      ${
        p
          ? `<div class="meter" style="margin-top:4px"><span class="meter-fill" style="width:${(p.progress * 100).toFixed(
              1
            )}%"></span></div>
             <div class="meter-row"><span class="num">${fmtPct(p.progress, 0)} complete</span><span class="num">~${fmtDuration(
              p.remaining * (live?.block_time_s ?? 12)
            )} left</span></div>`
          : ''
      }
    </div>`;
}

function renderValidatorQueue(live) {
  const vs = live?.validators ?? [];
  document.getElementById('validatorQueue').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Verification Queue</h2>
        <span class="badge plain">${vs.filter((v) => v.published).length}/${vs.length}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Validator</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>
            ${
              vs.length
                ? vs
                    .map(
                      (v) => `<tr>
                        <td class="mono" title="${esc(v.hotkey)}">${esc(shortAddr(v.hotkey, 6, 4))}</td>
                        <td>${
                          !v.published
                            ? '<span class="badge warning">◷ pending</span>'
                            : v.status === 'scored'
                            ? '<span class="badge good">✓ certified</span>'
                            : '<span class="badge critical">✕ refused</span>'
                        }</td>
                        <td class="dim tiny">${v.published_at ? timeAgo(v.published_at) : '—'}</td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="3" class="empty">No validators seen.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderChainHealth(subnet, live) {
  const keysPct = subnet ? (subnet.active_keys / subnet.max_neurons) * 100 : 0;
  const c = live?.submission_counts;
  const fillPct = c?.submitted ? (c.screened / c.submitted) * 100 : 0;

  document.getElementById('chainHealth').innerHTML = `
    <div class="panel">
      <div class="panel-header"><h2>Chain Health</h2></div>
      <div style="display:flex;justify-content:space-around;gap:10px;margin-top:4px">
        <div style="text-align:center">
          ${ring(keysPct, { size: 68, stroke: 7, color: 'var(--series-1)' })}
          <div class="dim tiny" style="margin-top:8px">Keys Used<br>${fmtNum(subnet?.active_keys)}/${fmtNum(
    subnet?.max_neurons
  )}</div>
        </div>
        <div style="text-align:center">
          ${ring(fillPct, { size: 68, stroke: 7, color: 'var(--series-4)' })}
          <div class="dim tiny" style="margin-top:8px">Heat Fill<br>${fmtNum(c?.screened)}/${fmtNum(c?.submitted)}</div>
        </div>
      </div>
      <dl class="kv" style="margin-top:16px">
        <dt>Immunity</dt><dd>${fmtNum(subnet?.immunity_period)} blk</dd>
        <dt>Min burn</dt><dd>${fmtRao(subnet?.min_burn, 3)} τ</dd>
      </dl>
    </div>`;
}

function renderActivity(events) {
  const CATEGORY = {
    registered: { label: 'REG', color: 'var(--series-1)' },
    deregistered: { label: 'DEREG', color: 'var(--series-2)' },
    stake_added: { label: 'STAKE+', color: 'var(--good)' },
    stake_removed: { label: 'STAKE-', color: 'var(--warning)' },
  };
  const rows = (events ?? []).slice(0, 9);

  document.getElementById('activity').innerHTML = `
    <div class="panel">
      <div class="panel-header"><h2>Recent Activity</h2><a class="small" href="/miners">View all →</a></div>
      ${
        rows.length
          ? rows
              .map((ev) => {
                const meta = CATEGORY[ev.category] ?? { label: ev.category, color: 'var(--ink-3)' };
                const detail =
                  ev.category === 'registered'
                    ? `uid ${ev.uid} registered`
                    : ev.category === 'deregistered'
                    ? `uid ${ev.uid} deregistered`
                    : `${fmtRao(ev.amount, 3)} τ ${ev.category === 'stake_added' ? 'staked to' : 'unstaked from'} ${shortAddr(
                        ev.delegate
                      )}`;
                return `<div class="activity-row">
                  <span class="activity-time">${timeAgo(ev.timestamp)}</span>
                  <span class="activity-msg"><span class="badge" style="color:${meta.color}">${meta.label}</span> ${esc(
                  detail
                )}</span>
                  <span class="dim tiny num">#${fmtNum(ev.block_number)}</span>
                </div>`;
              })
              .join('')
          : '<div class="empty">No recent chain events.</div>'
      }
    </div>`;
}

function renderValidatorStatus(live) {
  const vs = live?.validators ?? [];
  document.getElementById('validatorStatus').innerHTML = `
    <div class="panel">
      <div class="panel-header"><h2>Validator Status</h2><span class="dim small">certifying this round</span></div>
      ${
        vs.length
          ? vs
              .map(
                (v) => `<div class="activity-row" style="grid-template-columns:20px 1fr auto">
                  <span class="status-dot ${v.published ? (v.status === 'scored' ? 'on' : 'off') : 'wait'}"></span>
                  <span class="activity-msg mono">${esc(shortAddr(v.hotkey, 8, 6))}</span>
                  <span class="dim tiny">${
                    v.published ? (v.status === 'scored' ? 'certified' : 'refused') : 'pending'
                  }</span>
                </div>`
              )
              .join('')
          : '<div class="empty">No validators observed recently.</div>'
      }
    </div>`;
}

const STATE_ROW_BADGE = STATE_BADGE;

function renderSubmissionsTable(live) {
  const el = document.getElementById('submissions');
  const subs = live?.submissions ?? [];
  const c = live?.submission_counts;
  const heat = live?.heat;

  if (!subs.length || !c) {
    el.innerHTML = `<div class="panel"><div class="panel-header"><h2>Submission Verification</h2></div>
      <div class="empty">No screening results published yet.</div></div>`;
    return;
  }

  const current = heat?.is_current;
  const order = { advanced: 0, screened: 1, rejected: 2 };
  const rows = [...subs].sort(
    (a, b) => (order[a.state] - order[b.state]) || (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.uid - b.uid
  );

  el.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Submission Verification — ${fmtNum(c.submitted)} miners</h2>
        <span class="badge ${current ? 'good' : 'warning'}">${
    current ? '● this round' : `◷ epoch ${fmtNum(heat?.epoch_start_block)}`
  }</span>
      </div>
      <p class="panel-note" style="margin-bottom:12px">
        ${
          current
            ? 'Every generator submitted for the round in flight, and how far each one got.'
            : `The round in flight is still screening, so per-miner results are not published for it yet.
               These are the last settled results, from epoch ${fmtNum(heat?.epoch_start_block)}.`
        }
      </p>
      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat-tile"><div class="stat-label">Submitted</div><div class="stat-value">${fmtNum(
          c.submitted
        )}</div></div>
        <div class="stat-tile"><div class="stat-label">Screened</div><div class="stat-value">${fmtNum(
          c.screened
        )}</div></div>
        <div class="stat-tile"><div class="stat-label">Advanced</div><div class="stat-value">${fmtNum(
          c.advanced
        )}</div></div>
        <div class="stat-tile"><div class="stat-label">Rejected</div><div class="stat-value">${fmtNum(
          c.rejected
        )}</div><div class="stat-sub">${Object.keys(c.by_reason ?? {}).join(', ') || 'before screening'}</div></div>
      </div>
      <div class="table-wrap scroll-cap">
        <table class="data-table">
          <thead><tr><th>UID</th><th>Hotkey</th><th>Verification</th><th>Rank</th><th>CRPS</th><th>Detail</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (s) => `<tr class="stripe ${
                  s.state === 'advanced' ? 'role-advanced' : s.state === 'rejected' ? 'role-alert' : ''
                }">
                  <td><strong>${esc(s.uid ?? '—')}</strong></td>
                  <td class="mono" title="${esc(s.hotkey ?? '')}">${esc(shortAddr(s.hotkey))}</td>
                  <td>${STATE_ROW_BADGE[s.state] ?? esc(s.state)}</td>
                  <td class="num">${s.rank ?? '<span class="dim">—</span>'}</td>
                  <td class="num">${s.crps != null ? Number(s.crps).toFixed(6) : '<span class="dim">—</span>'}</td>
                  <td class="tiny dim">${s.reason ? esc(s.reason) : s.gen_ref ? esc(shortGenRef(s.gen_ref)) : ''}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${
        c.rejected_truncated
          ? `<div class="dim tiny" style="margin-top:10px">
               Showing ${fmtNum(c.rejected_listed)} of ${fmtNum(c.rejected)} rejections — the published
               heat document truncates the list, so the remaining ${fmtNum(
                 c.rejected - c.rejected_listed
               )} are counted but not named.
             </div>`
          : ''
      }
    </div>`;
}

async function load() {
  try {
    const [liveRes, latestRes, roundsRes, rewardsRes, subnetRes, mgRes, evRes] = await Promise.allSettled([
      fetchJSON('/api/cascade/live'),
      fetchJSON('/api/cascade/latest'),
      fetchJSON('/api/cascade/rounds'),
      fetchJSON('/api/rewards'),
      fetchJSON('/api/subnet'),
      fetchJSON('/api/metagraph'),
      fetchJSON('/api/events'),
    ]);

    const live = liveRes.status === 'fulfilled' ? liveRes.value : null;
    const latest = latestRes.status === 'fulfilled' ? latestRes.value : null;
    const roundsHist = roundsRes.status === 'fulfilled' ? roundsRes.value : null;
    const rewards = rewardsRes.status === 'fulfilled' ? rewardsRes.value : null;
    const subnet = subnetRes.status === 'fulfilled' ? subnetRes.value.data : null;
    const metagraph = mgRes.status === 'fulfilled' ? mgRes.value.data : [];
    const events = evRes.status === 'fulfilled' ? evRes.value.events : [];

    if (!live && !latest) {
      showError(document.getElementById('main'), new Error('no round data available'));
      return;
    }

    renderKpis({ live, latest, rewards, subnet, metagraph, roundsHist });
    renderRankings(metagraph, latest);
    renderPerformance(roundsHist);
    renderVerification(live);
    renderPipeline(live, subnet?.block_number);
    renderValidatorQueue(live);
    renderChainHealth(subnet, live);
    renderActivity(events);
    renderValidatorStatus(live);
    renderSubmissionsTable(live);

    const stale = [
      live?.stale && 'live status',
      latest?.stale && 'rounds',
      roundsRes.status === 'rejected' && 'round history',
    ].filter(Boolean);
    const missing = [
      subnetRes.status === 'rejected' && 'subnet',
      mgRes.status === 'rejected' && 'metagraph',
      evRes.status === 'rejected' && 'events',
    ].filter(Boolean);

    setStatus({ stale, missing });
    markUpdated();
  } catch (err) {
    showError(document.getElementById('main'), err);
  }
}

load();
setInterval(load, 60_000);
