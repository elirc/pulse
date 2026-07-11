<!--
Folio PR template. Every sprint lands as ONE PR built from docs/sprints/sprint-NN.md.
Fill every section. The most valuable part for the learner is "How to review this PR".
-->

## Context
<!-- What problem/user-need does this sprint address? Link the sprint playbook + issues. -->
Sprint: `docs/sprints/sprint-NN.md`
Closes #<!-- issue --> · Closes #<!-- issue -->

## Approach
<!-- The design in a few sentences. Why this shape and not the obvious alternative. -->

## Screenshots / recording
<!-- [do live] For UI or behavior. A short clip beats paragraphs. -->

## Tradeoffs considered
<!-- What you weighed. Link the planted debate thread + any ADR added this sprint. -->

## Deferred
<!-- What was intentionally left out, each as a linked issue (no orphan TODOs). -->

## Learning objectives
<!-- The 3–5 skills this PR is meant to teach. Pull from the sprint playbook. -->

## How to review this PR
<!-- THE teaching section. Give the exact file reading order so a junior can follow the
     story: schema → API → client → tests → docs. Point out the commits to read as a
     narrative (e.g. the planted-flaw → failing-test → fix arc). -->

---
### Author checklist (Definition of Done)
- [ ] Acceptance criteria in the sprint playbook pass
- [ ] Typecheck, lint, unit + integration tests green in CI
- [ ] E2E added/updated for the primary flow (S05 onward)
- [ ] Teaching comments placed on the diff (`📘 concept` / `🔍 review-lens` / `⚠️ pitfall` / `🔗 connects`)
- [ ] Planted debate thread posted + resolved; ADR added if an architectural decision was made
- [ ] Curriculum note updated (`docs/curriculum/sprint-NN.md`) with exercise questions
- [ ] Seed/demo updated so the feature is demoable
- [ ] No `any`, no skipped tests, no TODOs without linked issues
- [ ] **(LLM features)** eval dataset + graders + committed baseline in `docs/evals/` (eval-before-feature)
- [ ] **(LLM-touching changes)** tokens + $/action reported; cost regression reviewed like a latency regression
