# mosaic

Auto-discovering host for apps produced by skills (or built by hand). Each app
is an independently-built tile; mosaic just serves them and lists what's
attached — it has no per-app logic of its own.

## Quick start

```bash
./quick-start.sh start      # creates .venv via uv, launches on :47500
./quick-start.sh status
./quick-start.sh logs
./quick-start.sh stop
```

Dashboard: `http://localhost:47500/mosaic/`

### Always-on (systemd)

```bash
mkdir -p ~/.config/systemd/user
ln -s "$(pwd)/services/mosaic.service" ~/.config/systemd/user/mosaic.service
systemctl --user daemon-reload
systemctl --user enable --now mosaic.service
```

Uses `.venv` directly (via `uv venv`), so run `./quick-start.sh start` once
first to create it before enabling the unit.

## Onboarding an app

An app is a folder anywhere on disk (typically inside the skill that produces
it) shaped like this:

```
webapp/
├── app.json          # {id, name, description, version, entry}
├── static/            # served at /mosaic/apps/<id>/...  (entry defaults to index.html)
└── data/               # served at /mosaic/apps/<id>/data/...  — fully app-owned sub-paths
```

`app.json`:

```json
{
  "id": "kebab-case-id",
  "name": "Human name",
  "description": "One line, shown on the dashboard tile",
  "version": "1.0.0",
  "entry": "index.html"
}
```

Attach it:

```bash
scripts/onboard.sh /path/to/webapp
scripts/unboard.sh <app-id>     # detach (removes the symlink only, never the app's own files)
```

No restart needed — mosaic discovers apps by globbing `apps/*/app.json` on
every dashboard load.

## Contract mosaic guarantees

- `GET /mosaic/apps/{id}/{path}` — static passthrough from that app's `static/`.
- `GET /mosaic/apps/{id}/data/{path}` — passthrough from that app's `data/`; the
  sub-path structure under `data/` is entirely up to the app (one flat file, or
  as many nested paths as it wants).
- Both routes refuse to resolve outside the app's own directory.

## Tests

Playwright E2E suite against the actual FastAPI server (dashboard listing,
static + data passthrough, app-owned nested data sub-paths, and the
path-traversal guard). Onboards/unboards a throwaway fixture app under a
namespaced id (`mosaic-test-app`) — safe to run against a host with real apps
already attached.

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

Reuses an already-running mosaic on :47500 if there is one; otherwise starts
one from `.venv` for the run.

## What mosaic deliberately does not do

- No per-app backend code, ever — anything dynamic is the app's own client-side JS.
- No opinion on data format, pagination, archival tiers, or schema versioning
  inside `data/` — that's the app's manifest to own (a `data/manifest.json`
  convention is recommended: list datasets with `schema_version` so the app's
  frontend can gray out incompatible old data itself).
- No runtime registration API — attaching an app is a filesystem operation
  (`onboard.sh`), so it works whether or not mosaic is running at the time.
