# Cascade (SN91) Dashboard

A multi-page dashboard for Bittensor Subnet 91 (Cascade) — the round competition,
miner scores, and the audit trail behind them.

## Design

Dark violet console theme with a persistent sidebar (Overview / Rounds / Miners / Verification)
and a live topbar (subnet, block, tempo, round stage, local clock). The Overview dashboard uses
KPI cards with real historical sparklines (drawn from the 80-round history, not fabricated),
a ring-gauge verification panel, a performance chart with average/best/worst/std-dev quads, and
activity/validator-status panels — all backed by the same public receipt store and Taostats data
as the rest of the app. No panel shows invented numbers: widgets that would need local machine
telemetry (GPU/CPU, wallet balance, peer latency) were intentionally left out rather than faked,
since this is a passive dashboard over public chain and receipt data, not an agent running inside
a miner process.

## Setup

1. Copy `.env.example` to `.env` and paste in a [taostats.io/pro](https://taostats.io/pro) API key.
2. `npm install && npm start`
3. Open http://localhost:3000

The API key is only needed for the chain-side data (metagraph, registrations, stake flow).
Round, scoring and verification pages read the **public** Cascade receipt store and work
without any credentials.

## Pages

Four pages. The Overview is deliberately minimal — the detail lives one click away.

| Page | What it holds |
|---|---|
| **Overview** | The essentials: what stage the round is in and how long is left, who holds the crown, whether the last challenge succeeded, what the top of the reign chain earns — and the verification status of every submitted miner (advanced / screened / rejected, with the reason). |
| **Rounds** | The round in flight first — stage pipeline, screening progress, validator verification, submitted generators — then the full history and reign chain. Each row opens a per-round detail view. |
| **Miners** | The leaderboard (chain position joined to last round's scores), the reward distribution by rank, and chain activity: registrations, stake flow, and the metagraph. |
| **Verification** | How a round is proven, every validator's published receipt, and why receipts get rejected. |

`/live`, `/rewards` and `/chain` were folded into these and now redirect, so old links keep working.

Every page except the Overview carries a live status rail with the round's stage and clock; the
Overview omits it because its lead panel already says the same thing.

## How the subnet works

Miners don't submit models — they submit **synthetic data generators**. The model is held
byte-identical for everyone, so the only variable is data quality.

Each ~12h round (3600 blocks) runs in two phases. In the **heat**, every committed generator
trains a short reduced-size run and is ranked by CRPS; only the top finishers advance. In the
**final**, those finalists and the reigning king each train the full model on their own corpus
and forecast the same held-out windows.

The result is decided king-of-the-hill: a challenger's advantage over the king is bootstrapped
across evaluation windows, and the crown only moves if the **lower confidence bound** of that
advantage clears a **win margin** that decays as the king's tenure grows. Emission is split down
the reign chain, so recently dethroned kings keep earning a decaying share.

## Data sources

**Cascade receipts** — `https://s3.hippius.com/cascade-manifests/receipts/`. Validators publish
signed round receipts with public-read ACLs so third parties can audit rounds without credentials.
`index.json` lists every round; `<validator_hotkey>/round-<id>.json` is one validator's full receipt.

**Live status** — `status/round.json` is the trainer's stage document (`heat` → `duel` →
`validation`, with `heat_done`/`heat_total` inside the heat), and `status/heat.json` mirrors the
heat standings the moment they settle. Both are unsigned, single-writer and best-effort.

The heat pointer keeps serving the **previous** round's standings until the current heat settles,
so it is only presented as this round's when its `epoch_start_block` matches the round in flight —
otherwise the dashboard labels it as history. Joining on nothing would show last round's ranking as
this round's result, which is the exact failure the subnet's own design note warns about.

Per-miner submission results therefore only exist for a round once its heat has settled: mid-heat
the Overview names the epoch its results actually came from. The heat document also truncates its
rejected list, so rejections are counted in full but only the published subset can be named.

Each receipt is ~4.4MB (1200 per-window scores per entrant), so the server aggregates it into a
~55KB summary — distribution histograms, head-to-head win rates, descriptive statistics — and
caches only that. The browser never downloads raw score arrays.

Every round is scored **independently by each validator**, so a round can be accepted by two and
rejected by a third. The dashboard keeps all of them rather than collapsing to one, and flags any
round where scored validators disagree.

**Taostats** — chain state for SN91. Rate-limited at roughly **5 requests per 10 seconds**, so all
outbound calls are serialized through a queue with a 2.5s gap, retried with backoff on a 429, and
cached. Concurrent callers for the same resource share one request. If a refresh fails, the last
good copy is served and the header shows a `◷ Cached` badge naming the affected sources.

Note: Taostats' generic `/extrinsic` and `/event` endpoints accept a `netuid` parameter but
**silently ignore it**, so chain events are read from the `subnet/neuron/registration`,
`subnet/neuron/deregistration` and `delegation` endpoints, which filter for real.

## Layout

```
server.js          routes + page serving
src/taostats.js    chain data (rate-limited queue)
src/cascade.js     round receipts (fetch + aggregate)
src/cache.js       stale-on-failure cache with in-flight dedup
public/js/         one module per page, common.js shared
```

Reward amounts come from the chain (`daily_reward` per uid), not from multiplying the weight
fraction, so the two can be compared as a check that a round's weights reached the chain intact.
α is priced in τ and USD from the most recent on-chain stake trade, which costs no extra API call.

Set `SUBNET_NETUID` in `.env` to point the chain pages at a different subnet.

**Metagraph gotcha:** the `stake` field on every neuron is always `0` on this subnet — dTAO moved
staked value to `total_alpha_stake` (root + alpha stake combined). Use `total_alpha_stake` for any
stake figure; `stake` alone will silently render as zero everywhere.
