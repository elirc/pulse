#!/usr/bin/env bash
# Pulse — one-time GitHub setup: labels + milestones (+ enable Discussions).
# Prereqs: `gh auth login` done, and you are inside the pulse repo with an `origin` remote.
# Usage:   bash scripts/setup-github.sh
# Safe to re-run: labels use --force; milestone creation tolerates duplicates.

set -uo pipefail

echo "==> Repo: $(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo '??? (run inside the repo, after gh auth login)')"

label() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null 2>&1 && echo "  label: $1"; }

echo "==> Creating labels"
for n in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15; do
  label "sprint-$n" "ededed" "Sprint $n"
done
label "phase-mvp"  "0e8a16" "Phase 1 — MVP (S01–S05)"
label "phase-full" "1d76db" "Phase 2 — full product (S06–S15)"
# Teaching topics (Pulse — product analytics: ingestion, data engineering, SDK, experimentation)
label "teaching:ingestion"  "1d76db" "High-throughput event ingestion, backpressure, idempotency"
label "teaching:sdk"        "5319e7" "Browser SDK, bundle budget, ship-to-strangers discipline"
label "teaching:data-eng"   "5319e7" "Columnar storage, big aggregation, funnels/retention"
label "teaching:streams"    "fbca04" "Redis Streams, consumer groups, DLQ (Kafka concepts)"
label "teaching:identity"   "5319e7" "Persons, identity resolution, merge races"
label "teaching:migration"  "b60205" "Postgres → ClickHouse: dual-write, backfill, cutover"
label "teaching:stats"      "0e8a16" "Sampling, cardinality, significance, query cost"
label "teaching:security"   "b60205" "Ingestion chaos, GDPR, share-token abuse"
label "teaching:perf"       "fbca04" "Load testing, throughput/latency measurement (k6)"
# Process
label "learner-authored" "0e8a16" "[L]/[J] substantially written by the learner; AI reviews"
label "planted-debate"   "d93f0b" "A deliberate design debate thread lives on this PR"
label "deferred"         "c5def5" "Deferred work, filed as a linked issue"
label "lab"              "fef2c0" "Post-sprint practice branch/exercise"
label "adr"              "bfd4f2" "Introduces or changes an ADR"
label "good-first-read"  "7057ff" "A good PR for the learner to study first"

echo "==> Creating milestones (one per sprint)"
milestone() {
  gh api "repos/{owner}/{repo}/milestones" -f title="$1" -f state=open >/dev/null 2>&1 \
    && echo "  milestone: $1" || echo "  milestone exists/skip: $1"
}
milestone "Sprint 01 — Foundation: event → chart skeleton"
milestone "Sprint 02 — Orgs, projects & API keys"
milestone "Sprint 03 — Browser SDK v1"
milestone "Sprint 04 — Ingestion pipeline v1"
milestone "Sprint 05 — Insights v1: trends + live events"
milestone "Sprint 06 — Persons & identity resolution"
milestone "Sprint 07 — The migration: Postgres → ClickHouse"
milestone "Sprint 08 — Funnels"
milestone "Sprint 09 — Retention & cohorts"
milestone "Sprint 10 — Dashboards, sharing & subscriptions"
milestone "Sprint 11 — Live events & web analytics"
milestone "Sprint 12 — Sampling, cardinality & query cost"
milestone "Sprint 13 — Hardening: ingestion chaos & GDPR"
milestone "Sprint 14 — Feature flags & experiments"
milestone "Sprint 15 — Production readiness (v1.0.0)"

echo "==> Enabling Discussions"
gh api -X PATCH "repos/{owner}/{repo}" -f has_discussions=true >/dev/null 2>&1 && echo "  discussions enabled" || echo "  discussions: skip"
