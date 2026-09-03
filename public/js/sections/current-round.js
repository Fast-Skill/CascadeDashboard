import {
  fetchJSON,
  esc,
  fmtNum,
  fmtFixed,
  fmtPct,
  fmtDuration,
  shortAddr,
  shortGenRef,
  timeAgo,
  fmtDateTime,
  stepper,
  epochProgress,
  barCell,
  showError,
} from '../common.js';

function renderPipeline(live, liveBlock) {
  const p = epochProgress(liveBlock, live.epoch_blocks);
  const stage = live.stages?.[live.stage_index];

  document.getElementById('pipeline').innerHTML = `
    <div class="panel lead">
      <div class="panel-header">
        <div>
          <div class="eyebrow">Round in flight</div>
          <h2 style="font-size:18px;margin-top:3px">Epoch ${fmtNum(live.epoch_start_block)}</h2>
        </div>
        <div style="text-align:right">
          <div class="mono tiny dim">round ${esc(live.round_id ?? '—')}</div>
          <div class="tiny dim">trainer reported ${timeAgo(live.as_of)}</div>
        </div>
      </div>

      ${stepper(live)}

      <div style="margin-top:18px">
        ${
          p
            ? `<div class="meter"><span class="meter-fill" style="width:${(p.progress * 100).toFixed(1)}%"></span></div>
               <div class="meter-row">
                 <span><strong class="num">${fmtPct(p.progress, 1)}</strong> of the epoch elapsed · block ${fmtNum(
                liveBlock
              )}</span>
                 <span>${fmtNum(p.remaining)} blocks left · ~${fmtDuration(
                p.remaining * (live.block_time_s ?? 12)
              )}</span>
               </div>`
            : '<div class="dim small">No live block height available.</div>'
        }
      </div>

      ${
        stage
          ? `<div class="notice info" style="margin-top:16px;margin-bottom:0">
               <span>▸</span>
               <div><strong>${esc(stage.label)} —</strong> ${esc(stage.blurb)}</div>
             </div>`
          : ''
      }
    </div>`;
}

function renderStageDetail(live) {
  const isHeat = live.stage === 'heat';
  const heatPct = live.heat_total ? (live.heat_done ?? 0) / live.heat_total : null;
  const ws = live.warm_start ?? {};

  document.getElementById('stageDetail').innerHTML = `
    <div class="cols-2-wide">
      <div class="panel">
        <div class="panel-header"><h2>${isHeat ? 'Screening progress' : 'Stage progress'}</h2>
          <span class="dim small">${isHeat ? 'training slots completed' : esc(live.stage ?? '')}</span>
        </div>
        ${
          heatPct != null
            ? `<div class="hero-figure">${fmtNum(live.heat_done)}<span class="dim" style="font-size:22px"> / ${fmtNum(
                live.heat_total
              )}</span></div>
               <div class="dim small" style="margin-bottom:12px">generator slots trained this heat</div>
               <div class="meter"><span class="meter-fill" style="width:${(heatPct * 100).toFixed(
                 1
               )}%"></span></div>
               <div class="meter-row"><span>${fmtPct(heatPct, 0)} screened</span><span>${fmtNum(
                live.heat_total - live.heat_done
              )} remaining</span></div>`
            : `<div class="empty">The trainer is not reporting slot progress at this stage.</div>`
        }
      </div>

      <div class="panel">
        <div class="panel-header"><h2>Training base</h2></div>
        <p class="panel-note">Every entrant this round trains from the same promoted checkpoint, so the
          only variable left is the data their generator produced.</p>
        <dl class="kv">
          <dt>Warm-start generation</dt><dd class="num">${fmtNum(ws.generation)}</dd>
          <dt>Model size</dt><dd class="mono">${esc(ws.size ?? '—')}</dd>
          <dt>Init checkpoint</dt><dd class="digest">${esc(shortGenRef(ws.init_checkpoint))}</dd>
          <dt>Next scheduled init</dt><dd class="digest">${esc(shortGenRef(ws.next_scheduled_init))}</dd>
        </dl>
      </div>
    </div>`;
}

function renderValidators(live) {
  const vs = live.validators ?? [];
  const done = vs.filter((v) => v.published).length;
  const inValidation = live.stage === 'validation';

  document.getElementById('validators').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Validator verification</h2>
        <span class="badge ${done === vs.length && vs.length ? 'good' : 'plain'}">${done} of ${
    vs.length
  } reported</span>
      </div>
      <p class="panel-note">
        Once the duel finishes, the trainer publishes the manifest and each validator independently
        re-scores it and publishes a signed receipt. Until a validator's receipt appears for
        <span class="mono">round ${esc(live.round_id ?? '')}</span>, its verification is still outstanding.
      </p>
      ${
        !inValidation
          ? `<div class="notice"><span>◷</span><div>The round has not reached the validation stage yet, so no receipts
               are expected. Validators take over once the duel completes.</div></div>`
          : ''
      }
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Validator</th><th>Verification</th><th>Verdict</th><th>Reported</th><th>Reason</th></tr></thead>
          <tbody>
            ${
              vs.length
                ? vs
                    .map(
                      (v) => `<tr class="stripe ${v.published ? (v.status === 'rejected' ? 'role-alert' : 'role-advanced') : ''}">
                        <td class="mono" title="${esc(v.hotkey)}">${esc(shortAddr(v.hotkey, 8, 8))}</td>
                        <td>${
                          !v.published
                            ? '<span class="badge plain">◷ pending</span>'
                            : v.status === 'scored'
                            ? '<span class="badge good">✓ certified</span>'
                            : '<span class="badge critical">✕ refused</span>'
                        }</td>
                        <td>${
                          v.published
                            ? v.status === 'scored'
                              ? 'scored the round'
                              : 'declined to score'
                            : '<span class="dim">—</span>'
                        }</td>
                        <td class="dim">${v.published_at ? timeAgo(v.published_at) : '—'}</td>
                        <td class="wrap tiny dim">${esc(v.reject_reason ?? '')}</td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="5" class="empty">No validators seen publishing recently.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderSubmissions(live) {
  const heat = live.heat;
  const el = document.getElementById('submissions');

  if (!heat) {
    el.innerHTML = `<div class="panel"><div class="empty">No heat standings published.</div></div>`;
    return;
  }

  // The heat pointer keeps serving the previous round until this round's heat
  // settles, so standings are only "this round" when the epoch matches.
  const current = heat.is_current;
  const entrants = [...(heat.entrants ?? [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const maxP = Math.max(...entrants.map((e) => e.p_best ?? 0), 1e-9);
  const skipped = heat.skipped;

  el.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Submitted generators — screening results</h2>
        <span class="badge ${current ? 'good' : 'warning'}">${
    current ? '● this round' : '◷ last settled heat'
  }</span>
      </div>
      ${
        current
          ? `<p class="panel-note">Live standings for the round in flight, published the moment the heat settled.</p>`
          : `<div class="notice"><span>◷</span><div>
               This round's heat has not settled yet, so these are the standings from
               <strong>epoch ${fmtNum(heat.epoch_start_block)}</strong> (published ${timeAgo(heat.as_of)}).
               They are shown as history, not as this round's result — the live pointer keeps serving the
               previous round until the current screen finishes.
             </div></div>`
      }

      <div class="stat-grid" style="margin-bottom:16px">
        <div class="stat-tile"><div class="stat-label">Screened</div><div class="stat-value">${fmtNum(
          heat.screened
        )}</div><div class="stat-sub">entered the heat</div></div>
        <div class="stat-tile"><div class="stat-label">Advanced</div><div class="stat-value">${fmtNum(
          heat.finalists
        )}</div><div class="stat-sub">reached the duel</div></div>
        <div class="stat-tile"><div class="stat-label">Skipped</div><div class="stat-value">${fmtNum(
          skipped?.total
        )}</div><div class="stat-sub">rejected before screening</div></div>
        <div class="stat-tile"><div class="stat-label">Eval windows</div><div class="stat-value">${fmtNum(
          heat.n_windows
        )}</div><div class="stat-sub">${fmtNum(heat.n_clusters)} clusters</div></div>
        <div class="stat-tile"><div class="stat-label">Screen size</div><div class="stat-value" style="font-size:16px">${esc(
          heat.screen_size ?? '—'
        )}</div><div class="stat-sub">model preset</div></div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Rank</th><th>UID</th><th>Hotkey</th><th>Submitted generator</th>
            <th>CRPS</th><th>MASE</th><th>p(best)</th><th>Rel. score</th><th>Outcome</th>
          </tr></thead>
          <tbody>
            ${entrants
              .map(
                (e) => `<tr class="stripe ${e.status === 'advanced' ? 'role-advanced' : ''}">
                  <td class="num">${esc(e.rank ?? '—')}</td>
                  <td><strong>${esc(e.uid)}</strong></td>
                  <td class="mono" title="${esc(e.hotkey ?? '')}">${esc(shortAddr(e.hotkey))}</td>
                  <td class="mono tiny" title="${esc(e.gen_ref ?? '')}">${esc(shortGenRef(e.gen_ref))}</td>
                  <td class="num">${fmtFixed(e.crps, 6)}</td>
                  <td class="num">${fmtFixed(e.mase, 5)}</td>
                  <td>${barCell(e.p_best, maxP, { label: fmtPct(e.p_best, 2), color: 'var(--series-3)' })}</td>
                  <td class="num">${fmtFixed(e.rel_score, 5)}</td>
                  <td>${
                    e.status === 'advanced'
                      ? '<span class="badge good">✓ advanced</span>'
                      : `<span class="badge plain">${esc(e.status ?? 'screened')}</span>`
                  }</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>

      ${
        skipped?.total
          ? `<div class="section-title">Rejected before screening — ${fmtNum(skipped.total)} submissions</div>
             <p class="panel-note">These generators were filtered out before any compute was spent on them.</p>
             <div class="cols-2">
               <div class="table-wrap">
                 <table class="data-table">
                   <thead><tr><th>Reason</th><th>Submissions</th></tr></thead>
                   <tbody>
                     ${Object.entries(skipped.by_reason ?? {})
                       .sort((a, b) => b[1] - a[1])
                       .map(
                         ([r, n]) =>
                           `<tr><td class="mono tiny">${esc(r)}</td><td class="num">${fmtNum(n)}</td></tr>`
                       )
                       .join('')}
                   </tbody>
                 </table>
               </div>
               <div class="table-wrap">
                 <table class="data-table">
                   <thead><tr><th>UID</th><th>Hotkey</th><th>Reason</th></tr></thead>
                   <tbody>
                     ${(skipped.entries ?? [])
                       .map(
                         (s) => `<tr>
                           <td>${esc(s.uid ?? '—')}</td>
                           <td class="mono" title="${esc(s.hotkey ?? '')}">${esc(shortAddr(s.hotkey))}</td>
                           <td class="tiny dim">${esc(s.reason)}</td>
                         </tr>`
                       )
                       .join('')}
                     ${
                       skipped.entries_truncated
                         ? `<tr><td colspan="3" class="dim tiny center">…${fmtNum(
                             skipped.total - (skipped.entries ?? []).length
                           )} more not listed in the published document</td></tr>`
                         : ''
                     }
                   </tbody>
                 </table>
               </div>
             </div>`
          : ''
      }
    </div>`;
}

export async function mountCurrentRound() {
  try {
    const [liveRes, subnetRes] = await Promise.allSettled([
      fetchJSON('/api/cascade/live'),
      fetchJSON('/api/subnet'),
    ]);

    const stale = [];
    const missing = [];

    if (liveRes.status !== 'fulfilled') {
      showError(document.getElementById('pipeline'), liveRes.reason);
      return { stale: [], missing: ['live status'] };
    }
    const live = liveRes.value;
    if (live.stale) stale.push('live status');

    let liveBlock = null;
    if (subnetRes.status === 'fulfilled') {
      liveBlock = subnetRes.value.data?.block_number ?? null;
      if (subnetRes.value.stale) stale.push('subnet');
    } else {
      missing.push('subnet');
    }

    renderPipeline(live, liveBlock);
    renderStageDetail(live);
    renderValidators(live);
    renderSubmissions(live);

    return { stale, missing };
  } catch (err) {
    showError(document.getElementById('pipeline'), err);
    return { stale: [], missing: ['live status'] };
  }
}
