import {
  mountChrome,
  setStatus,
  markUpdated,
  fetchJSON,
  esc,
  fmtNum,
  fmtFixed,
  shortAddr,
  shortGenRef,
  statusBadge,
  timeAgo,
  fmtDateTime,
  divergingBar,
  showError,
} from './common.js';
import { mountCurrentRound } from './sections/current-round.js';

mountChrome();

let all = [];
let reigns = [];

function renderSummary(idx) {
  const t = idx.totals;
  document.getElementById('summary').innerHTML = `
    <div class="stat-grid">
      <div class="stat-tile"><div class="stat-label">Rounds</div><div class="stat-value">${fmtNum(
        t.rounds
      )}</div><div class="stat-sub">${fmtNum(t.receipts)} validator receipts</div></div>
      <div class="stat-tile"><div class="stat-label">Scored</div><div class="stat-value">${fmtNum(
        t.scored
      )}</div><div class="stat-sub">accepted by validators</div></div>
      <div class="stat-tile"><div class="stat-label">Rejected</div><div class="stat-value">${fmtNum(
        t.rejected
      )}</div><div class="stat-sub">failed a verification gate</div></div>
      <div class="stat-tile"><div class="stat-label">Dethrones</div><div class="stat-value">${fmtNum(
        t.dethrones
      )}</div><div class="stat-sub">crown changed hands</div></div>
      <div class="stat-tile"><div class="stat-label">Reigns</div><div class="stat-value">${fmtNum(
        reigns.length
      )}</div><div class="stat-sub">distinct kings</div></div>
    </div>`;
}

function renderReigns() {
  const maxRounds = Math.max(...reigns.map((r) => r.rounds), 1);
  document.getElementById('reigns').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h2>Reign history</h2>
        <span class="dim small">newest first · length in rounds held</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>UID</th><th>Hotkey</th><th>Generator</th><th>Rounds held</th>
            <th>From block</th><th>To block</th><th>Started</th>
          </tr></thead>
          <tbody>
            ${reigns
              .map(
                (r, i) => `<tr class="${i === 0 ? 'is-king' : ''}">
                  <td><strong>${esc(r.uid)}</strong>${i === 0 ? ' <span class="badge good">current</span>' : ''}</td>
                  <td class="mono" title="${esc(r.hotkey ?? '')}">${esc(shortAddr(r.hotkey))}</td>
                  <td class="mono tiny">${esc(shortGenRef(r.gen_ref))}</td>
                  <td>
                    <div class="bar-cell">
                      <span class="num" style="min-width:26px">${r.rounds}</span>
                      <span class="bar-track"><span class="bar" style="width:${
                        (r.rounds / maxRounds) * 100
                      }%"></span></span>
                    </div>
                  </td>
                  <td class="num">${fmtNum(r.from_block)}</td>
                  <td class="num">${fmtNum(r.to_block)}</td>
                  <td class="dim">${fmtDateTime(r.from)}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderTable() {
  const status = document.getElementById('fStatus').value;
  const result = document.getElementById('fResult').value;
  const search = document.getElementById('fSearch').value.trim().toLowerCase();

  const rows = all.filter((r) => {
    if (status && r.status !== status) return false;
    if (result === 'dethroned' && !r.dethroned) return false;
    if (result === 'held' && (r.dethroned || r.status !== 'scored')) return false;
    if (search) {
      const hay = `${r.round_id} ${r.epoch_start_block} ${r.king_uid} ${r.chal_uid} ${r.king_hotkey ?? ''} ${
        r.chal_hotkey ?? ''
      }`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  document.getElementById('tableBody').innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr>
            <td class="num">${fmtNum(r.epoch_start_block)}</td>
            <td>${statusBadge(r.status, r.reject_reason)}</td>
            <td>${
              r.n_receipts > 1
                ? `<span class="badge plain" title="${esc(
                    r.receipts.map((x) => `${shortAddr(x.validator_hotkey)}: ${x.status}`).join('\n')
                  )}">${r.n_scored}/${r.n_receipts} scored</span>`
                : `<span class="dim">${r.n_receipts}</span>`
            }${r.validators_disagree ? ' <span class="badge warning">⚠ disagree</span>' : ''}</td>
            <td>uid ${esc(r.king_uid ?? '—')}</td>
            <td>uid ${esc(r.chal_uid ?? '—')}</td>
            <td class="num">${fmtFixed(r.king_geomean, 6)}</td>
            <td class="num">${fmtFixed(r.chal_geomean, 6)}</td>
            <td class="num">${fmtFixed(r.lcb, 5)}</td>
            <td class="num">${fmtFixed(r.margin, 4)}</td>
            <td>${r.win_rate != null ? divergingBar(r.win_rate) : '<span class="dim">—</span>'}</td>
            <td>${
              r.status !== 'scored'
                ? '<span class="dim">—</span>'
                : r.dethroned
                ? '<span class="badge critical">dethroned</span>'
                : '<span class="badge plain">held</span>'
            }</td>
            <td class="num">${fmtNum(r.n_participants)}</td>
            <td class="dim">${timeAgo(r.published_at)}</td>
            <td><a href="/round?id=${encodeURIComponent(r.round_id)}">detail →</a></td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="14" class="empty">No rounds match these filters.</td></tr>`;

  document.getElementById('rowCount').textContent = `${rows.length} of ${all.length} rounds`;
}

async function load() {
  try {
    const liveState = await mountCurrentRound();
    const idx = await fetchJSON('/api/cascade/rounds');
    all = idx.rounds ?? [];
    reigns = idx.reigns ?? [];

    renderSummary(idx);
    renderReigns();

    document.getElementById('roundTable').innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h2>All rounds</h2>
          <div class="filters">
            <input id="fSearch" type="search" placeholder="round id, block, uid, hotkey…" />
            <select id="fStatus">
              <option value="">All statuses</option>
              <option value="scored">Scored</option>
              <option value="rejected">Rejected</option>
            </select>
            <select id="fResult">
              <option value="">Any result</option>
              <option value="dethroned">Dethroned</option>
              <option value="held">King held</option>
            </select>
            <span id="rowCount" class="dim small" style="align-self:center"></span>
          </div>
        </div>
        <p class="panel-note">
          One row per round. Each round is scored independently by every validator; the
          <em>receipts</em> column shows how many agreed to score it.
          <strong>LCB</strong> is the challenger's lower confidence bound over the king — it must exceed the
          <strong>margin</strong> for a dethrone.
        </p>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>Epoch block</th><th>Status</th><th>Receipts</th><th>King</th><th>Challenger</th>
              <th>King geomean</th><th>Chal geomean</th><th>LCB</th><th>Margin</th>
              <th>Win rate</th><th>Result</th><th>Miners</th><th>Published</th><th></th>
            </tr></thead>
            <tbody id="tableBody"></tbody>
          </table>
        </div>
      </div>`;

    for (const id of ['fSearch', 'fStatus', 'fResult']) {
      document.getElementById(id).addEventListener('input', renderTable);
    }
    renderTable();

    setStatus({
      stale: [...(liveState?.stale ?? []), ...(idx.stale ? ['rounds'] : [])],
      missing: liveState?.missing ?? [],
    });
    markUpdated();
  } catch (err) {
    showError(document.getElementById('main'), err);
  }
}

load();
