import {
  fetchJSON,
  esc,
  fmtNum,
  fmtFixed,
  fmtPct,
  shortAddr,
  timeAgo,
  showError,
} from '../common.js';

const alpha = (v, d = 2) => (v == null ? '—' : `${fmtNum(v, d)} α`);

function renderHeadline(data) {
  const top = data.ranks[0];
  const t = data.totals;
  const p = data.price;
  const missing = data.unavailable ?? [];

  document.getElementById('headline').innerHTML = `
    ${
      missing.includes('metagraph')
        ? `<div class="notice"><span>⚠</span><div>
             <strong>Amounts are unavailable right now.</strong> Weights and shares below come from the round
             receipt, but the payout figures are read from the chain metagraph, which did not respond —
             usually the Taostats rate limit under a cold cache. Amounts fill in on the next refresh.
           </div></div>`
        : ''
    }
    <div class="cols-2-wide">
      <div class="panel lead">
        <div class="eyebrow">Top of the reign chain</div>
        <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-top:6px">
          <div class="hero-figure">${top ? fmtNum(top.daily_alpha, 0) : '—'}</div>
          <div>
            <div style="font-size:16px;font-weight:600">α per day</div>
            <div class="dim small">to uid ${esc(top?.uid ?? '—')} — the reigning king</div>
          </div>
        </div>
        <div class="stat-grid" style="margin-top:16px">
          <div class="stat-tile"><div class="stat-label">In TAO</div><div class="stat-value">${
            top?.daily_tao != null ? fmtNum(top.daily_tao, 2) + ' τ' : '—'
          }</div><div class="stat-sub">per day</div></div>
          <div class="stat-tile"><div class="stat-label">In USD</div><div class="stat-value">${
            top?.daily_usd != null ? '$' + fmtNum(top.daily_usd, 0) : '—'
          }</div><div class="stat-sub">per day</div></div>
          <div class="stat-tile"><div class="stat-label">Share of miner pool</div><div class="stat-value">${fmtPct(
            top?.share,
            1
          )}</div><div class="stat-sub">weight ${fmtFixed(top?.weight, 4)}</div></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header"><h2>Where emission goes</h2></div>
        <p class="panel-note">Miner emission is split down the reign chain. Validators receive the other
          half of subnet emission as dividends.</p>
        <dl class="kv">
          <dt>Miners (reign chain)</dt><dd class="num">${alpha(t.miner_daily_alpha)} / day</dd>
          <dt>Validators</dt><dd class="num">${alpha(t.validator_daily_alpha)} / day</dd>
          <dt>Subnet total</dt><dd class="num">${alpha(t.subnet_daily_alpha)} / day</dd>
          <dt>Earning uids</dt><dd class="num">${fmtNum(t.rewarded_uids)}</dd>
        </dl>
        <div class="section-title" style="margin-bottom:6px">Alpha price</div>
        ${
          p
            ? `<dl class="kv">
                 <dt>1 α</dt><dd class="num">${fmtFixed(p.tao, 6)} τ${
                p.usd != null ? ` · $${fmtNum(p.usd, 2)}` : ''
              }</dd>
                 <dt>Observed</dt><dd>${timeAgo(p.observed_at)} <span class="dim">at block ${fmtNum(
                p.block_number
              )}</span></dd>
               </dl>
               <div class="dim tiny" style="margin-top:6px">Marked from the most recent on-chain stake trade,
                 so τ and USD figures move with the pool.</div>`
            : '<div class="dim small">No recent trade to price α — amounts shown in α only.</div>'
        }
      </div>
    </div>`;
}

function renderLadder(data) {
  const ranks = data.ranks;
  const max = Math.max(...ranks.map((r) => r.daily_alpha ?? 0), 1e-9);

  document.getElementById('ladder').innerHTML = `
    <div class="panel flush">
      <div style="padding:18px 20px 0">
        <div class="panel-header" style="margin-bottom:8px">
          <h2>Reward distribution by rank</h2>
          <span class="dim small">round ${fmtNum(data.round?.epoch_start_block)} · per day at current emission</span>
        </div>
        <p class="panel-note">
          Rank 1 is the current king; each rank below is a previous king still ageing out of the chain.
          Every step is meant to halve — the measured ratio is shown so any drift from that is visible.
        </p>
      </div>
      <div class="ladder">
        ${ranks
          .map(
            (r) => `<div class="rung ${r.rank === 1 ? 'top' : ''}">
              <div class="rung-rank">#${r.rank}</div>
              <div>
                <div style="font-weight:600">uid ${esc(r.uid)}${
              r.rank === 1 ? ' <span class="badge accent">king</span>' : ''
            }</div>
                <div class="mono tiny dim" title="${esc(r.hotkey ?? '')}">${esc(shortAddr(r.hotkey))}</div>
              </div>
              <div>
                <div class="rung-bar"><span class="rung-fill" style="width:${
                  ((r.daily_alpha ?? 0) / max) * 100
                }%"></span></div>
                <div class="dim tiny" style="margin-top:4px">
                  weight ${fmtFixed(r.weight, 4)} · ${fmtPct(r.share, 1)} of the miner pool${
              r.decay_from_previous != null
                ? ` · ×${fmtFixed(r.decay_from_previous, 3)} of rank ${r.rank - 1}`
                : ''
            }
                </div>
              </div>
              <div class="rung-amount">
                <div class="big">${alpha(r.daily_alpha)}</div>
                <div class="dim tiny">${
                  r.daily_tao != null ? `${fmtNum(r.daily_tao, 3)} τ` : ''
                }${r.daily_usd != null ? ` · $${fmtNum(r.daily_usd, 0)}` : ''}</div>
              </div>
            </div>`
          )
          .join('')}
      </div>
    </div>`;
}

function renderTable(data) {
  const ranks = data.ranks;
  document.getElementById('detail').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Amounts in full</h2>
        <span class="dim small">emission figures read from the chain, not derived from weight</span>
      </div>
      <p class="panel-note">
        Weight is what the validators assigned; α per day is what the chain is actually paying that uid.
        They agree here, which is the check that the round's weights reached the chain intact.
      </p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Rank</th><th>UID</th><th>Hotkey</th><th>Weight</th><th>Share</th>
            <th>Incentive</th><th>α / day</th><th>τ / day</th><th>USD / day</th>
            <th>α / block</th><th>Decay</th>
          </tr></thead>
          <tbody>
            ${ranks
              .map(
                (r) => `<tr class="stripe ${r.rank === 1 ? 'role-king' : ''}">
                  <td class="num">${r.rank}</td>
                  <td><strong>${esc(r.uid)}</strong></td>
                  <td class="mono" title="${esc(r.hotkey ?? '')}">${esc(shortAddr(r.hotkey))}</td>
                  <td class="num">${fmtFixed(r.weight, 5)}</td>
                  <td class="num">${fmtPct(r.share, 2)}</td>
                  <td class="num">${fmtFixed(r.incentive, 5)}</td>
                  <td class="num"><strong>${fmtNum(r.daily_alpha, 2)}</strong></td>
                  <td class="num">${r.daily_tao != null ? fmtNum(r.daily_tao, 3) : '—'}</td>
                  <td class="num">${r.daily_usd != null ? '$' + fmtNum(r.daily_usd, 2) : '—'}</td>
                  <td class="num dim">${fmtNum(r.emission_alpha, 3)}</td>
                  <td class="num">${
                    r.decay_from_previous != null ? '×' + fmtFixed(r.decay_from_previous, 4) : '—'
                  }</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

export async function mountRewards() {
  try {
    const data = await fetchJSON('/api/rewards');
    if (!data.ranks?.length) {
      document.getElementById('headline').innerHTML =
        '<div class="panel"><div class="empty">No weights were set in the last scored round.</div></div>';
      return { stale: [], missing: [] };
    }
    renderHeadline(data);
    renderLadder(data);
    renderTable(data);

    return { stale: data.price?.stale ? ['price'] : [], missing: data.unavailable ?? [] };
  } catch (err) {
    showError(document.getElementById('headline'), err);
    return { stale: [], missing: ['rewards'] };
  }
}
