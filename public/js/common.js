export const NAV = [
  { href: '/', label: 'Overview', icon: 'grid' },
  { href: '/rounds', label: 'Rounds', icon: 'flag' },
  { href: '/miners', label: 'Miners', icon: 'users' },
  { href: '/verification', label: 'Verification', icon: 'shield' },
];

export const ROLE_COLOR = {
  king: 'var(--series-1)',
  challenger: 'var(--series-2)',
  baseline: 'var(--ink-3)',
};

const ICONS = {
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
  flag: '<path d="M5 3v18M5 4h11l-2.5 3.5L16 11H5"/>',
  users: '<path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3 2.5-5 6-5s6 2 6 5M17 11a3 3 0 1 0 0-6M15 20c0-2.5 1.5-4.3 4-4.8"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
};

function icon(name, cls = 'ico') {
  const body = ICONS[name] ?? '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* ---------- formatting ---------- */

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtNum(v, digits = 0) {
  if (v === undefined || v === null || v === '') return '—';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtFixed(v, digits = 4) {
  if (v === undefined || v === null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(digits);
}

export function fmtPct(v, digits = 1) {
  if (v === undefined || v === null || !Number.isFinite(Number(v))) return '—';
  return `${(Number(v) * 100).toFixed(digits)}%`;
}

export function fmtRao(v, digits = 3) {
  if (v === undefined || v === null) return '—';
  return (Number(v) / 1e9).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function shortAddr(addr, head = 6, tail = 6) {
  if (!addr) return '—';
  const s = typeof addr === 'string' ? addr : (addr.ss58 ?? addr.hex ?? '');
  if (!s) return '—';
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Generator refs look like `owner/name@sha256:abc…` — keep the name, shorten the digest. */
export function shortGenRef(ref) {
  if (!ref) return '—';
  const at = ref.lastIndexOf('@');
  if (at < 0) return ref;
  const name = ref.slice(0, at);
  const digest = ref.slice(at + 1);
  const colon = digest.indexOf(':');
  const algo = colon >= 0 ? digest.slice(0, colon) : '';
  const hex = colon >= 0 ? digest.slice(colon + 1) : digest;
  return `${name}@${algo ? algo + ':' : ''}${hex.slice(0, 8)}…`;
}

export function shortDigest(d, n = 12) {
  if (!d) return '—';
  const s = String(d);
  return s.length <= n * 2 ? s : `${s.slice(0, n)}…${s.slice(-6)}`;
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ---------- fetch ---------- */

export async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  return res.json();
}

/* ---------- components ---------- */

export function roleBadge(role) {
  const color = ROLE_COLOR[role] ?? 'var(--ink-3)';
  return `<span class="badge"><span class="dot" style="background:${color}"></span>${esc(role ?? '—')}</span>`;
}

export function statusBadge(status, rejectReason) {
  if (status === 'scored') return `<span class="badge good">✓ scored</span>`;
  if (status === 'rejected') {
    const title = rejectReason ? ` title="${esc(rejectReason)}"` : '';
    return `<span class="badge critical"${title}>✕ rejected</span>`;
  }
  return `<span class="badge plain">${esc(status ?? '—')}</span>`;
}

export function boolBadge(value, trueLabel, falseLabel) {
  return value
    ? `<span class="badge good">✓ ${esc(trueLabel)}</span>`
    : `<span class="badge plain">○ ${esc(falseLabel)}</span>`;
}

/** Horizontal bar sized as a fraction of `max`. */
export function barCell(value, max, { color = 'var(--series-1)', label } = {}) {
  const pct = max > 0 ? Math.min(100, (Number(value) / max) * 100) : 0;
  return `<div class="bar-cell">
    <span class="num" style="min-width:56px">${esc(label ?? fmtFixed(value, 4))}</span>
    <span class="bar-track"><span class="bar" style="width:${pct}%;background:${color}"></span></span>
  </div>`;
}

/**
 * Diverging bar around a midpoint — for values whose meaning is "above or below
 * a reference" (win rate vs 0.5, LCB vs 0). Blue above, red below, gray middle.
 */
export function divergingBar(value, { mid = 0.5, range = 0.1 } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const delta = Math.max(-range, Math.min(range, v - mid));
  const halfPct = (Math.abs(delta) / range) * 50;
  const positive = delta >= 0;
  const style = positive
    ? `left:50%;width:${halfPct}%;background:var(--diverge-pos)`
    : `right:50%;width:${halfPct}%;background:var(--diverge-neg)`;
  return `<div class="bar-cell">
    <span class="num" style="min-width:52px">${fmtPct(v, 1)}</span>
    <span class="dv"><span class="dv-mid"></span><span class="dv-bar" style="${style}"></span></span>
  </div>`;
}

/** Small multiple histogram — one per entry, so 5 series never overlay into mud. */
export function histogramFacet(hist, { color = 'var(--series-1)', title = '' } = {}) {
  if (!hist || !hist.counts?.length) return `<div class="facet"><div class="empty">No data</div></div>`;
  const max = Math.max(...hist.counts);
  const bars = hist.counts
    .map((c) => `<span class="hist-bar" style="height:${max ? (c / max) * 100 : 0}%;background:${color}"></span>`)
    .join('');
  return `<div class="facet">
    <div class="facet-title">${title}</div>
    <div class="hist">${bars}</div>
    <div class="hist-caption"><span>${fmtFixed(hist.lo, 2)}</span><span>MASE</span><span>${fmtFixed(hist.hi, 2)}</span></div>
  </div>`;
}

/** Epoch boundaries are multiples of epoch_blocks, so the live round is derivable. */
export function epochProgress(block, epochBlocks) {
  if (block == null || !epochBlocks) return null;
  const start = Math.floor(block / epochBlocks) * epochBlocks;
  const elapsed = block - start;
  return { start, end: start + epochBlocks, elapsed, remaining: epochBlocks - elapsed, progress: elapsed / epochBlocks };
}

/**
 * The round's stage machine. `stageIndex` is where the trainer says it is; every
 * earlier stage is complete, so the strip reads as progress rather than a menu.
 */
export function stepper(live, { compact = false, vertical = false } = {}) {
  const stages = live?.stages ?? [];
  const idx = live?.stage_index ?? -1;

  return `<div class="${vertical ? 'stepper-v' : 'stepper'}">
    ${stages
      .map((s, i) => {
        const state = idx < 0 ? '' : i < idx ? 'done' : i === idx ? 'active' : '';
        let meta = compact ? '' : s.blurb;
        if (i === idx && s.key === 'heat' && live.heat_total) {
          meta = `${fmtNum(live.heat_done)} of ${fmtNum(live.heat_total)} slots trained`;
        } else if (i === idx && s.key === 'validation') {
          const done = (live.validators ?? []).filter((v) => v.published).length;
          meta = `${done} of ${(live.validators ?? []).length} validators reported`;
        } else if (compact) {
          meta = '';
        }
        return `<div class="${vertical ? 'step-v' : 'step'} ${state}">
          <div class="step-idx">${i + 1}</div>
          <div style="min-width:0">
            <div class="step-name">${esc(s.label)}</div>
            ${meta ? `<div class="step-meta">${esc(meta)}</div>` : ''}
          </div>
        </div>`;
      })
      .join('')}
  </div>`;
}

/** Persistent context strip: what the tournament is doing right now, on sub-pages. */
export function renderRail(live, liveBlock) {
  const el = document.getElementById('liveRail');
  if (!el || !live) return;

  const p = epochProgress(liveBlock ?? null, live.epoch_blocks);
  const stageLabel = live.stages?.[live.stage_index]?.label ?? 'Idle';

  el.innerHTML = `
    <div class="rail">
      <div>
        <div class="rail-live"><span class="pulse"></span>Round in progress — ${esc(stageLabel)}</div>
        <div class="dim tiny" style="margin-top:4px">
          epoch ${fmtNum(live.epoch_start_block)} · reported ${timeAgo(live.as_of)}
        </div>
      </div>
      ${stepper(live, { compact: true })}
      <div>
        ${
          p
            ? `<div class="meter"><span class="meter-fill" style="width:${(p.progress * 100).toFixed(1)}%"></span></div>
               <div class="meter-row">
                 <span class="num">${fmtPct(p.progress, 0)}</span>
                 <span class="num">~${fmtDuration(p.remaining * (live.block_time_s ?? 12))} left</span>
               </div>`
            : '<div class="dim tiny">No block height</div>'
        }
      </div>
    </div>`;
}

/** Fetch and render the live rail. Safe to call on any page; failures stay silent. */
export async function mountRail(knownBlock) {
  try {
    const live = await fetchJSON('/api/cascade/live');
    let block = knownBlock ?? null;
    if (block == null) {
      const subnet = await fetchJSON('/api/subnet').catch(() => null);
      block = subnet?.data?.block_number ?? live.epoch_start_block ?? null;
    }
    renderRail(live, block);
  } catch {
    /* the rail is context, not content — a page still works without it */
  }
}

/* ---------- inline SVG chart primitives ---------- */

/** A minimal line+area sparkline. Values plotted left-to-right, oldest first. */
export function sparkline(values, { width = 100, height = 32, color = 'var(--accent)', fill = true } = {}) {
  const vals = (values ?? []).filter((v) => Number.isFinite(v));
  if (vals.length < 2) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
  }
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const pad = 2;
  const step = (width - pad * 2) / (vals.length - 1);
  const pts = vals.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - lo) / span) * (height - pad * 2);
    return [x, y];
  });
  const line = pts.map((p) => p.join(',')).join(' ');
  const uid = `sg${Math.random().toString(36).slice(2, 8)}`;
  const area = fill
    ? `<polygon points="${pad},${height - pad} ${line} ${width - pad},${height - pad}" fill="url(#${uid})" stroke="none"/>`
    : '';
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${area}
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.2" fill="${color}"/>
  </svg>`;
}

/** A donut/ring gauge with the percentage (or custom label) centered. */
export function ring(pct, { size = 56, stroke = 6, color = 'var(--accent)', track = 'var(--surface-sunk)', label, sub } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct ?? 0));
  const offset = c * (1 - clamped / 100);
  const center = size / 2;
  return `<div class="ring-wrap" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
      <circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
        transform="rotate(-90 ${center} ${center})"/>
    </svg>
    <div class="ring-center">
      <div class="rv">${label ?? Math.round(clamped) + '%'}</div>
      ${sub ? `<div class="rl">${sub}</div>` : ''}
    </div>
  </div>`;
}

/* ---------- page chrome: sidebar + topbar ---------- */

let liveStatsTimer = null;
let clockTimer = null;

async function refreshTopbarStats() {
  const pillsEl = document.getElementById('statPills');
  const footEl = document.getElementById('sidebarStatus');
  if (!pillsEl && !footEl) return;

  try {
    const [liveRes, subnetRes] = await Promise.allSettled([fetchJSON('/api/cascade/live'), fetchJSON('/api/subnet')]);
    const live = liveRes.status === 'fulfilled' ? liveRes.value : null;
    const subnet = subnetRes.status === 'fulfilled' ? subnetRes.value.data : null;
    const online = subnetRes.status === 'fulfilled';
    const block = subnet?.block_number ?? live?.epoch_start_block ?? null;
    const stageLabel = live?.stages?.[live.stage_index]?.label ?? '—';

    if (pillsEl) {
      pillsEl.innerHTML = `
        <div class="stat-pill"><div class="pill-label">Subnet</div><div class="pill-value accent">#${esc(
          subnet?.netuid ?? live?.netuid ?? 91
        )}</div></div>
        <div class="stat-pill"><div class="pill-label">Network</div><div class="pill-value">Finney</div></div>
        <div class="stat-pill"><div class="pill-label">Block</div><div class="pill-value">${fmtNum(block)}</div></div>
        <div class="stat-pill"><div class="pill-label">Tempo</div><div class="pill-value">${fmtNum(
          subnet?.tempo
        )} blk</div></div>
        <div class="stat-pill"><div class="pill-label">Stage</div><div class="pill-value good">${esc(
          stageLabel
        )}</div></div>
        <div class="stat-pill"><div class="pill-label">Local Time</div><div class="pill-value" id="clockValue">${new Date().toLocaleTimeString()}</div></div>`;
    }

    if (footEl) {
      footEl.innerHTML = `
        <div class="sidebar-status-row">
          <span class="status-dot ${online ? 'on' : 'off'}"></span>
          <span style="color:${online ? 'var(--good)' : 'var(--critical)'}">${online ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <div class="sidebar-kv"><span>Netuid</span><b>#${esc(subnet?.netuid ?? 91)}</b></div>
        <div class="sidebar-kv"><span>Miners</span><b>${fmtNum(subnet?.active_miners)}</b></div>
        <div class="sidebar-kv"><span>Validators</span><b>${fmtNum(subnet?.active_validators)}</b></div>
        <div class="sidebar-kv"><span>Round stage</span><b>${esc(stageLabel)}</b></div>`;
    }
  } catch {
    /* chrome stats are context, not content */
  }
}

function tickClock() {
  const el = document.getElementById('clockValue');
  if (el) el.textContent = new Date().toLocaleTimeString();
}

/**
 * Populates the sidebar (`#sidebar`) and topbar (`#topbar`) mount points that
 * every page's HTML already declares as siblings of `<main>` inside `.app` /
 * `.workspace` — chrome fills gaps in a fixed skeleton, it doesn't build the
 * skeleton itself, so the CSS grid nesting is never at the mercy of an
 * innerHTML string trying to wrap elements outside its own container.
 */
export function mountChrome({ active } = {}) {
  const path = active ?? window.location.pathname;
  const sidebar = document.getElementById('sidebar');
  const topbar = document.getElementById('topbar');
  if (!sidebar && !topbar) return;

  const links = NAV.map((n) => {
    const isActive = n.href === '/' ? path === '/' : path.startsWith(n.href);
    return `<a href="${n.href}" class="side-link ${isActive ? 'active' : ''}">${icon(n.icon)}<span class="label">${n.label}</span></a>`;
  }).join('');

  const currentPage = NAV.find((n) => (n.href === '/' ? path === '/' : path.startsWith(n.href)));

  if (sidebar) {
    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <div class="sidebar-brand-text">
          <div class="sidebar-brand-name">CASCADE</div>
          <div class="sidebar-brand-sub">SN91 Console</div>
        </div>
        <button class="collapse-btn" id="collapseBtn" type="button" title="Collapse sidebar" aria-label="Collapse sidebar">${icon(
          'chevron'
        )}</button>
      </div>
      <div class="sidebar-section-title">Menu</div>
      ${links}
      <div class="sidebar-section-title">Network</div>
      <a class="side-link" href="https://taostats.io/subnets/91" target="_blank" rel="noopener">${icon('grid')}<span class="label">Subnet Explorer</span></a>
      <a class="side-link" href="/miners">${icon('users')}<span class="label">Validators</span></a>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-footer-card" id="sidebarStatus">
        <div class="sidebar-status-row"><span class="status-dot"></span><span class="dim">Connecting…</span></div>
      </div>`;

    document.getElementById('collapseBtn')?.addEventListener('click', () => {
      document.getElementById('appRoot')?.classList.toggle('collapsed');
    });
  }

  if (topbar) {
    topbar.innerHTML = `
      <div>
        <h1>${esc(currentPage?.label ?? 'Dashboard')}</h1>
        <div class="subtitle">Cascade (SN91) — synthetic time-series data tournament on Bittensor</div>
      </div>
      <div class="topbar-right">
        <div class="stat-pills" id="statPills"></div>
        <span id="dataStatus" class="badge" hidden></span>
        <span id="lastUpdated" class="dim small"></span>
      </div>`;
  }

  refreshTopbarStats();
  if (liveStatsTimer) clearInterval(liveStatsTimer);
  liveStatsTimer = setInterval(refreshTopbarStats, 30_000);
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 1000);
}

/** Overrides the topbar's h1 after data loads — for pages like round detail
 * where the nav-derived label ("Rounds") is too generic once the specific
 * item is known. */
export function setTopbarTitle(title) {
  const h1 = document.querySelector('#topbar h1');
  if (h1) h1.textContent = title;
}

/**
 * Chain data is metered by Taostats credits. When the balance hits zero every
 * chain call fails, and a generic "Unavailable" badge leaves the cause a
 * mystery — so name it, and say the round data is unaffected.
 */
export async function checkCredits() {
  try {
    const cfg = await fetchJSON('/api/config');
    const el = document.getElementById('creditNotice');
    if (!el) return;
    if (cfg.credits?.blocked) {
      el.hidden = false;
      el.innerHTML = `<div class="notice"><span>⚠</span><div>
        <strong>Taostats credits exhausted (${esc(cfg.credits.detail ?? 'balance empty')}).</strong>
        Chain-backed panels — miner rankings, stake, emission and chain events — cannot load until the
        balance is topped up at <a href="https://dash.taostats.io/billing" target="_blank" rel="noopener">dash.taostats.io/billing</a>.
        Round, verification and submission data come from the public Cascade store and are unaffected.
      </div></div>`;
    } else if (!cfg.apiKeyConfigured) {
      el.hidden = false;
      el.innerHTML = `<div class="notice"><span>⚠</span><div>
        <strong>No Taostats API key configured.</strong> Chain-backed panels stay empty until
        <span class="mono">TAOSTATS_API_KEY</span> is set. Round and verification data are unaffected.
      </div></div>`;
    } else {
      el.hidden = true;
    }
  } catch {
    /* the notice is advisory; never block the page on it */
  }
}

export function setStatus({ stale = [], missing = [] } = {}) {
  // A page only learns *why* chain data is missing after its own calls have
  // failed, so re-check the credit state whenever something came back missing.
  if (missing.length) checkCredits();

  const el = document.getElementById('dataStatus');
  if (!el) return;
  if (missing.length) {
    el.hidden = false;
    el.className = 'badge critical';
    el.textContent = `✕ Unavailable: ${missing.join(', ')}`;
  } else if (stale.length) {
    el.hidden = false;
    el.className = 'badge warning';
    el.textContent = `◷ Cached: ${stale.join(', ')}`;
  } else {
    el.hidden = true;
  }
}

export function markUpdated() {
  const el = document.getElementById('lastUpdated');
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

export function showError(container, err) {
  container.innerHTML = `<div class="panel"><div class="empty">Could not load: ${esc(err.message)}</div></div>`;
}
