# Arogya — PLAN

**Crafted by Vivek Nair (VN) — https://github.com/vivekn4**
**Status:** v2.1.0 — Calm Hub shipped (local-only). Backend unchanged.
**Rules:** zero-budget · no API keys/secrets in the repo · privacy-first (no accounts, no chat storage) · calm-maximalist: beautiful, never loud.

## What Arogya is

A calm, private, AI-powered wellness companion. Guided chat (body area → symptoms → duration → severity → natural remedies) with safety guardrails (disclaimer gate, crisis + emergency detection), plus a local-only **Calm Hub**: breathing, quiet timer, daily check-in, gentle habits, progress.

**Not a medical service.** Never diagnoses, never suggests medication, always redirects emergencies to real help.

## Teardown — what we learned from similar apps (2026-10-14)

Studied three real apps from trustworthy sources only (official F-Droid, official GitHub releases, official GitHub source). Mechanisms were re-implemented in original code; no proprietary code, assets, strings, or brand material was copied. Licenses of the studied apps (GPL-3.0 / AGPL-3.0 / MIT) were respected — Arogya stays MIT with original implementations.

| App | Artifact (verified) | Mechanisms learned |
|---|---|---|
| **Loop Habit Tracker** 2.3.1 (GPL-3.0) | F-Droid APK `org.isoron.uhabits_20301.apk`, SHA-256 `3903d3be…b8173e` | Habit = name + prompt question + frequency as numerator/denominator (3/7 = 3×/week) + per-habit reminder + measurable target + color. Habit-strength score: exponential smoothing toward each day's completion ratio over a rolling window; skipped days don't move it; a few misses barely dent a long streak. Streaks as a separate list with best-streak query. |
| **Medito** 2.0.48 (AGPL-3.0) | Official GitHub release APK `medito-v2.0.48.apk`, SHA-256 `7d602e1d…56e434c9` | Track = title/description/cover + artist + multiple guide voices + audio files with durations. Stats: current/longest streak, total tracks, total time listened. **Streak freezes** (max 2): a missed day consumes a freeze instead of breaking the streak. **Consistency score** as a forgiving alternative to raw streak. Timer: one-tap countdown presets (3/5/10/15/20 min) + stopwatch, min 1-min session counts, start/end bells, background audio service. Packs = sequenced multi-day programs. |
| **breathing-circle** (MIT) | Official GitHub source, REA JS analysis (1 file, 1932 AST nodes) | Technique table as (inhale, inhale-hold, exhale, exhale-hold) seconds + benefits + when-to-use. Phase state machine (inhale → hold? → exhale → hold? → cycle) driven by chained timers, zero phases skipped. Session timer + cycle counter + progress bar + pause/resume/stop + preferences in localStorage + custom pattern. |

### Implemented in Arogya (v2.1.0, all original code)

1. **Calm Hub — Breathe** (`frontend/calm.js` + `CalmHub` in `app.js`): 5 techniques (4-7-8, Box, Coherent, Extended Exhale, Triangle) + custom pattern, with my own wording; animated breathing circle; session lengths 1/3/5/10 min; cycle counter + progress; soft bell per phase, success shimmer on completion; sessions ≥60s recorded.
2. **Calm Hub — Quiet timer**: countdown presets 3/5/10/15/20 min + custom minutes + open-ended stopwatch; start/end bell; ≥60s counts.
3. **Calm Hub — Check-in**: 5-mood picker + optional note + 7-day mood strip; gentle habits (name + frequency: daily / 5× / 3× / 2× / weekly) with Done / Skip / Undo; skip pauses the streak without punishing; habit-strength bar via exponential smoothing; weekly progress (done/target).
4. **Calm Hub — Progress**: calm streak (any check-in, habit, or ≥60s session counts as an active day), 2 monthly streak freezes (refill on the 1st; only recent days are settled — first run settles yesterday only), 30-day consistency %, totals (breathing min, quiet min, sessions), per-habit strength.
5. **Local-only by design**: all Calm Hub data lives in `localStorage` (`vn_arogya_calm_v1`), never sent to the backend. Privacy Policy updated to say so. Service worker precaches `calm.js` (cache `arogya-v3`).
6. **Tests**: `frontend/calm.test.js` — 16 tests (node:test, zero deps) covering phases, smoothing, streaks, freezes, sessions, persistence. Run: `node --test frontend/calm.test.js`.

### Deliberately skipped (with reasons)

- **Per-habit reminder notifications** (Loop does per-habit exact alarms): a web PWA can't reliably deliver exact-time alarms; Notification API permission prompts would add friction to a calm app. In-app habit list + the daily check-in habit is the v2.1 scope. Revisit only if the PWA ships a real notification UX.
- **Audio-guided meditations / voice guides / background sounds** (Medito): needs licensed audio files or TTS; zero-budget + no-asset-copying rules block lifting anyone else's tracks. The quiet timer + bell is the free, original alternative.
- **Meditation packs / sequenced programs** (Medito): content-heavy; needs authored programs. A "7-day gentle start" pack is a future content task, not a teardown task.
- **Cloud sync / accounts**: contradicts the privacy-first promise (anonymous, no storage). Local-only is the feature.
- **Binaural beats / breath-rate mic detection** (seen in other breathing apps): mic access in a wellness app is a privacy red flag and overkill; the manual phase machine is calmer and private.
- **Habit reminders via backend push**: no backend push infra, no accounts — out of scope by design.

## Architecture

```
frontend/  index.html (loads sfx.js, particles.js, config.js, calm.js, app.js via Babel)
           app.js     — React 18 UMD, zero build: Disclaimer → Welcome → Chat / CalmHub
           calm.js    — framework-free Calm Hub logic + localStorage (window.VN_CALM)
           calm.test.js — node:test suite for calm.js (vm sandbox, zero deps)
           sfx.js     — WebAudio SFX (blip, chime, bell, success, whoosh)
           styles.css — design system + Calm Hub styles
           sw.js      — precache shell (arogya-v3), cache-first static, network-only /api/*
backend/   server.js  — Express: provider-agnostic /api/chat (+ /api/chat/stream),
                        strict-JSON envelope, safety system prompt, rate-limit, helmet
```

Calm Hub state shape (`vn_arogya_calm_v1`): `{ version, habits[], logs{habitId: {date: done|skip}}, moods{date: {mood, note}}, sessions[{type, seconds, date, at}], frozenDays[], freezesRemaining, freezeRefillMonth, settledThrough }`.

Key rules (documented in code):
- Strength: `score += 0.18 × (target − score)`; target 1 = done, 0 = missed; skip = unchanged; new habits start at 0.5.
- Habit streak: consecutive done days; skip pauses (neither grows nor breaks); past day with no entry breaks; today undecided never breaks.
- Calm streak: active day = mood check-in OR habit done OR session ≥60s. Missed past day spends a freeze if one remains; freezes refill to 2 on month change; settling covers only days since last settle (first run: yesterday only).
- Consistency: active days / 30 over the last 30 days.

## Roadmap (not yet built)

- [ ] "7-day gentle start" pack: one tiny practice per day (breathing → timer → habit → check-in…), authored original content.
- [ ] Gentle in-app nudge: if no check-in by evening, show a soft banner on the Welcome screen (no push).
- [ ] Export my Calm Hub data (download JSON) + erase-all button in Progress.
- [ ] Chat → Calm Hub deep link: when the chat hears stress/mood language, offer a one-tap breathing break (button already exists in the chat header; auto-offer is future).
- [ ] Mood-note word cloud / monthly mood summary (local-only).
- [ ] Habit reminder time field (in-app display only until real notifications exist).

## QA

- `node --check` on all frontend JS (except `app.js` — JSX, validated via esbuild parse instead) + `backend/server.js`.
- `node --test frontend/calm.test.js` — 16/16 pass.
- Backend: `npm install` + `/health` + `/ready` + chat smoke test.
- Browser render check: NOT done in this pass (no browser harness in the worker) — verify Calm Hub visually after deploy: open Calm Hub, run a 1-min breathe session, check in a mood, add/complete a habit, confirm Progress numbers move.

## Security

- No keys/secrets in the repo. `AI_API_KEY` lives only as a Render env var (or `.env`, gitignored) — never in chat/files.
- Calm Hub data never leaves the device; the backend logs request counts only, never message contents.
