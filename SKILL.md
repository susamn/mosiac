---
name: mosaic-maintainer
description: Maintain, optimize, and extend the mosaic app host — the auto-discovering webapp under tools/ that serves apps produced by data-app skills. Use this skill when adding a feature to mosaic itself, changing its onboarding/staging contract, debugging why an app isn't showing up, or reviewing its security surface.
version: 1.0.0
triggers:
  - "improve mosaic"
  - "optimize mosaic"
  - "add a feature to mosaic"
  - "work on the mosaic project"
  - "debug mosaic onboarding"
intent: system
created_at: 2026-07-30
updated_at: 2026-07-30
---

# Mosaic Project Maintainer & Developer Guide

This local skill governs the design, maintenance, and extension of the `mosaic` project — not part of the shared skill roster, discovered only when working inside this directory.

---

## 1. Project Philosophy & Core Architecture

Mosaic is a **generic, install-independent app host**. It has exactly two routes and zero opinions about any individual app:

- `GET /mosaic/apps/{id}/{path}` — static passthrough from that app's `webapp/static/`.
- `GET /mosaic/apps/{id}/data/{path}` — passthrough from that app's data, sub-path structure fully app-owned.

**The one rule that must never be broken: no per-app backend code, ever.** If a specific app needs something the two generic routes can't express, that is a design conversation about extending the *generic* contract — never a special-cased route, branch, or file for one app. An app's rendering, data format, pagination, and versioning are entirely its own client-side JS; mosaic only serves files.

Apps and their data live **outside this repo**, at a fixed, install-independent location:

```
~/.local/share/mosaic/
├── apps/            # staging symlinks only — one per onboarded app, NEVER rclone this
│   └── <id> -> <skill-path>/webapp
└── data/             # the actual data — rclone this, and only this
    └── <id>/
```

A skill attaches with `mkdir -p ~/.local/share/mosaic/apps && ln -sfn <webapp> ~/.local/share/mosaic/apps/<id>` — it never references this repo's own location (`$TOOLS_PATH/mosaic` or otherwise). This was a real bug fixed once already (staging directory used to live inside this repo's own `apps/`, coupling every skill to wherever mosaic happened to be installed) — don't reintroduce it. Full contract: `~/dotfiles/skills/skill-creator/references/data-app-skills.md` (the canonical doc other skills follow — a change to mosaic's contract must be mirrored there too, see §4).

Mosaic discovers apps by globbing `apps/*/app.json` on every dashboard request — no caching, no registration API, no restart needed after onboarding. This is deliberate: at the expected scale (tens of apps, not thousands), a live glob is simpler and can never go stale. Don't add a cache without a real, measured reason.

---

## 2. Directory Layout Reference

```
mosaic/
├── backend/
│   ├── app.py                 # FastAPI: dashboard + the two generic routes only
│   ├── requirements.txt
│   ├── templates/dashboard.html
│   └── static/dashboard.css    # mosaic's OWN shell styling — not an app's
├── scripts/
│   ├── onboard.sh               # convenience: validation + data-migration fallback
│   └── unboard.sh                # convenience: detach (never touches app source/data)
├── services/
│   └── mosaic.service            # systemd user unit (not installed/enabled by default)
├── tests/
│   ├── playwright.config.ts
│   ├── fixtures/test-app/         # throwaway fixture — copied to a temp dir per run
│   └── specs/mosaic.spec.ts
├── quick-start.sh                 # start/stop/restart/status/logs; uv-managed .venv
├── README.md
├── .gitignore
└── SKILL.md                       # this guide
```

**`apps/` and `data/` are intentionally not in this tree.** They live at `~/.local/share/mosaic/`, outside the repo entirely — if you go looking for onboarded apps here, that's the wrong place; see §1.

---

## 3. Workflow: Adding a Generic Capability

Before writing anything, confirm the need is genuinely generic — applies to *any* app, not one app's specific quirk. If it's app-specific, the answer is "the app's own JS handles it," not a mosaic change.

1. Update `backend/app.py` — keep routes minimal; reuse `resolve_within()` for any new filesystem-touching route (§6).
2. Update `tests/specs/mosaic.spec.ts` to cover it.
3. Update `README.md`'s "Contract mosaic guarantees" section.
4. If the change touches the onboarding/staging contract specifically, it must *also* land in `~/dotfiles/skills/skill-creator/references/data-app-skills.md` — that's a separate repo (the `skills` submodule), and skipping it leaves every future data-app skill's instructions stale. Run `skill-manager`'s audit afterward: `~/dotfiles/skills/skill-manager/scripts/audit.sh skill-creator`.
5. Restart the running dev instance (`./quick-start.sh restart`) and re-run the full Playwright suite before considering it done.

---

## 4. Workflow: Changing the Onboarding/Staging Contract

This is the highest-blast-radius kind of change — it affects every data-app skill, not just mosaic. Checklist, all four are required:

1. `backend/app.py` — wherever `APPS_DIR` (or the data-home equivalent) is resolved.
2. `scripts/onboard.sh` / `scripts/unboard.sh` — same path, kept in sync.
3. `README.md` — the onboarding section.
4. `~/dotfiles/skills/skill-creator/references/data-app-skills.md` — the actual contract skills read; this is the one most likely to be forgotten because it's in a different repo.

Then: restart the dev instance, full Playwright run, `skill-manager` audit on `skill-creator`. Don't consider the change done until all four files agree and both checks pass.

---

## 5. Testing & Quality Gate

```bash
cd tests
npm install                     # first time only
npx playwright install chromium  # first time only
npm test
```

Reuses an already-running mosaic on `:47500` if there is one (`reuseExistingServer` in `playwright.config.ts`); otherwise starts one from `.venv` for the run. The fixture app is copied into a temp dir and onboarded under a namespaced id (`mosaic-test-app`) with a temp `MOSAIC_APPS_DIR`/data home where relevant — the suite must never mutate the checked-in fixture or touch a real user's onboarded apps. Every change to `app.py`, `onboard.sh`, or `unboard.sh` **must** be verified by a full run before being considered done — not just a manual curl check.

---

## 6. Standalone Commit Workflow

`mosaic` is its own git repo (destined to become a dotfiles submodule, not yet added). To commit:

```bash
cd ~/dotfiles/workspace/tools/mosaic
git add <files>
git commit -m "description"
```

- **Never push, never run `gh pr create`** — the SSH remote key is passphrase-protected and `gh` isn't installed on this machine. Commit locally and hand off the exact push command.
- **Never bump the dotfiles submodule pointer** (once mosaic is added as one) unless explicitly asked — a commit request for mosaic authorizes exactly that commit, not cascading housekeeping in the parent repo.
- Prefer several small, logically-sequenced commits over one large one when a change touches multiple concerns (e.g., host code / onboarding scripts / docs / tests as separate commits) — this has been the working pattern so far and reads better in history.

---

## 7. Developer Guardrails

- **No per-app backend code, ever** (§1). This is the invariant everything else here protects.
- **Apps never need mosaic's install path.** Onboarding always goes through the fixed `~/.local/share/mosaic/apps/` staging directory — never reintroduce `$TOOLS_PATH/mosaic` (or any install-relative path) into the required contract.
- **`apps/` is symlinks-only and never synced.** Only `~/.local/share/mosaic/data/` is the rclone target — syncing `apps/` to another machine would just produce broken links there.
- **Be merciful with directory creation.** Every place mosaic touches its own runtime directories (`APPS_DIR`, `DATA_HOME`) must use idempotent creation (`mkdir(exist_ok=True)` / `mkdir -p`) — create once if missing, never error or touch if already present.
- **Path-traversal guard is non-negotiable.** Any new route that resolves a filesystem path from a request must go through the same containment check as `resolve_within()` (resolve both root and candidate, verify `is_relative_to`). Test it with **encoded** traversal (`%2e%2e`), not literal `../` — HTTP clients normalize literal dot-segments before mosaic ever sees them, so a literal-`../` test proves nothing.
- **No destructive actions from the dashboard UI.** No live DELETE endpoint for app or data cleanup, even for "incompatible" or stale data — that stays a deliberate CLI/skill step, never a button a stray click can trigger.
- **Bind to `127.0.0.1` only**, by default. This is a localhost-only tool; exposing it to a LAN or beyond is a real security decision to make explicitly later, not a default to drift into.
- **The visual/rendering vocabulary question is not mosaic's to answer.** Individual data-app skills have full liberty over how they render — mosaic must never grow an opinion here, shared rendering code, or a "recommended" library baked into the host itself.
