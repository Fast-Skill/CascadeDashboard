import {
  fetchJSON,
  esc,
  fmtNum,
  fmtFixed,
  fmtRao,
  shortAddr,
  timeAgo,
  showError,
} from '../common.js';

const CATEGORY = {
  registered: { label: 'Registered', color: 'var(--series-1)' },
  deregistered: { label: 'Deregistered', color: 'var(--series-2)' },
  stake_added: { label: 'Stake Added', color: 'var(--series-3)' },
  stake_removed: { label: 'Stake Removed', color: 'var(--series-4)' },
};

let events = [];
let neurons = [];

function renderStats(subnet) {
  if (!subnet) return;
  const tiles = [
    ['Active miners', fmtNum(subnet.active_miners), ''],
    ['Active validators', fmtNum(subnet.active_validators), ''],
    ['Registered keys', `${fmtNum(subnet.active_keys)} / ${fmtNum(subnet.max_neurons)}`, ''],
    ['Registration cost', `${fmtRao(subnet.neuron_registration_cost, 4)} τ`, 'burned per registration'],
    ['Tempo', fmtNum(subnet.tempo), 'blocks'],
    ['Immunity period', fmtNum(subnet.immunity_period), 'blocks'],
  ];
  document.getElementById('chainStats').innerHTML = `
    <div class="stat-grid">
      ${tiles
        .map(
          ([l, v, s]) =>
            `<div class="stat-tile"><div class="stat-label">${l}</div><div class="stat-value">${v}</div>${
              s ? `<div class="stat-sub">${s}</div>` : ''
            }</div>`
        )
        .join('')}
    </div>`;
}

function describe(ev) {
  switch (ev.category) {
    case 'registered':
      return `uid ${ev.uid} · ${fmtRao(ev.cost, 4)} τ burned`;
    case 'deregistered':
      return `uid ${ev.uid} · incentive ${fmtFixed(ev.incentive, 4)}${ev.was_drained ? ' · drained' : ''}`;
    case 'stake_added':
    case 'stake_removed': {
      const arrow = ev.category === 'stake_added' ? '→' : '←';
      const usd = ev.usd ? ` ($${fmtNum(ev.usd, 2)})` : '';
      return `${fmtRao(ev.amount, 4)} τ ${arrow} ${fmtRao(ev.alpha, 2)} α${usd} · via ${shortAddr(ev.delegate)}`;
    }
    default:
      return '—';
  }
}

function renderEvents() {
  const q = document.getElementById('eSearch').value.trim().toLowerCase();
  const type = document.getElementById('eType').value;

  const list = events.filter((ev) => {
    if (type && ev.category !== type) return false;
    if (q) {
      const hay = `${ev.account ?? ''} ${ev.hotkey ?? ''} ${ev.coldkey ?? ''} ${ev.delegate ?? ''} ${
        ev.uid ?? ''
      }`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  document.getElementById('eBody').innerHTML = list.length
    ? list
        .map((ev) => {
          const meta = CATEGORY[ev.category] ?? { label: ev.category, color: 'var(--text-muted)' };
          return `<tr>
            <td><span class="badge"><span class="dot" style="background:${meta.color}"></span>${meta.label}</span></td>
            <td class="num">${fmtNum(ev.block_number)}</td>
            <td class="dim" title="${esc(ev.timestamp ?? '')}">${timeAgo(ev.timestamp)}</td>
            <td class="mono" title="${esc(ev.account ?? '')}">${esc(shortAddr(ev.account))}</td>
            <td class="dim">${esc(describe(ev))}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="5" class="empty">No events match.</td></tr>`;
}

function renderMetagraph() {
  const q = document.getElementById('mSearch').value.trim().toLowerCase();
  const role = document.getElementById('mRole').value;

  const list = neurons.filter((n) => {
    const isVal = Boolean(n.validator_permit);
    if (role === 'validator' && !isVal) return false;
    if (role === 'miner' && isVal) return false;
    if (q && !`${n.uid} ${n.hotkey?.ss58 ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });

  document.getElementById('mBody').innerHTML = list.length
    ? list
        .map(
          (n) => `<tr>
            <td>${n.uid}</td>
            <td class="mono" title="${esc(n.hotkey?.ss58 ?? '')}">${esc(shortAddr(n.hotkey?.ss58))}</td>
            <td>${n.validator_permit ? 'Validator' : 'Miner'}</td>
            <td class="num">${fmtRao(n.total_alpha_stake, 2)}</td>
            <td class="num">${fmtFixed(n.trust, 4)}</td>
            <td class="num">${fmtFixed(n.incentive, 4)}</td>
            <td class="num">${fmtRao(n.emission, 4)}</td>
            <td class="num">${fmtRao(n.daily_reward, 3)}</td>
            <td class="num">${fmtNum(n.updated)}</td>
            <td>${
              n.active ? '<span class="badge good">● active</span>' : '<span class="badge critical">○ inactive</span>'
            }</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="10" class="empty">No neurons match.</td></tr>`;
}

export async function mountChain() {
  try {
    const [subnetRes, mgRes, evRes] = await Promise.allSettled([
      fetchJSON('/api/subnet'),
      fetchJSON('/api/metagraph'),
      fetchJSON('/api/events'),
    ]);

    const stale = [];
    const missing = [];

    if (subnetRes.status === 'fulfilled') {
      renderStats(subnetRes.value.data);
      if (subnetRes.value.stale) stale.push('subnet');
    } else missing.push('subnet');

    if (mgRes.status === 'fulfilled') {
      neurons = mgRes.value.data ?? [];
      if (mgRes.value.stale) stale.push('metagraph');
    } else missing.push('metagraph');

    if (evRes.status === 'fulfilled') {
      events = evRes.value.events ?? [];
      stale.push(...(evRes.value.degraded ?? []));
      missing.push(...(evRes.value.missing ?? []));
    } else missing.push('events');

    document.getElementById('events').innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h2>Chain events</h2>
          <div class="filters">
            <input id="eSearch" type="search" placeholder="address or uid…" />
            <select id="eType">
              <option value="">All event types</option>
              ${Object.entries(CATEGORY)
                .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <p class="panel-note">Registrations, deregistrations and stake flow for SN91, newest first.</p>
        <div class="legend">
          ${Object.values(CATEGORY)
            .map((c) => `<span class="legend-item"><span class="dot" style="background:${c.color}"></span>${c.label}</span>`)
            .join('')}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Type</th><th>Block</th><th>Time</th><th>Account</th><th>Details</th></tr></thead>
            <tbody id="eBody"></tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('metagraph').innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <h2>Metagraph</h2>
          <div class="filters">
            <input id="mSearch" type="search" placeholder="uid or hotkey…" />
            <select id="mRole">
              <option value="">All neurons</option>
              <option value="validator">Validators</option>
              <option value="miner">Miners</option>
            </select>
          </div>
        </div>
        <p class="panel-note"><strong>Updated</strong> is blocks since that neuron last had its weights set.</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>UID</th><th>Hotkey</th><th>Role</th><th>Stake (α)</th><th>Trust</th>
              <th>Incentive</th><th>Emission (α)</th><th>Daily (α)</th><th>Updated</th><th>Status</th>
            </tr></thead>
            <tbody id="mBody"></tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('eSearch').addEventListener('input', renderEvents);
    document.getElementById('eType').addEventListener('change', renderEvents);
    document.getElementById('mSearch').addEventListener('input', renderMetagraph);
    document.getElementById('mRole').addEventListener('change', renderMetagraph);
    renderEvents();
    renderMetagraph();

    return { stale, missing };
  } catch (err) {
    showError(document.getElementById('events'), err);
    return { stale: [], missing: ['chain'] };
  }
}
