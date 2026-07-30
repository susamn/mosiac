"""mosaic — auto-discovering host for skill-produced apps.

Three routes carry every app's own behavior; this host has no per-app logic:
  GET    /mosaic/apps/{id}/{path}       static assets (js, css, the app's index.html)
  GET    /mosaic/apps/{id}/data/{path}  app-owned data, sub-paths fully app-defined
  DELETE /mosaic/apps/{id}/data/{path}  delete one file or sub-directory of that data;
                                         never the app's whole data/ root in one call —
                                         an app's own frontend calls this for its own
                                         delete UI (single or, composed client-side,
                                         bulk); mosaic's own dashboard never exposes it.

Apps are discovered by globbing APPS_DIR/*/app.json — a fixed,
install-independent staging directory (default ~/.local/share/mosaic/apps),
never a path relative to wherever this mosaic install happens to live. A
skill attaches by symlinking its own webapp/ in there directly; it never
needs to know or reference this install's location. No registration step, no
restart needed after onboarding (see ../scripts/onboard.sh, or
references/data-app-skills.md in skill-creator for the raw filesystem
contract a skill follows itself).
"""
import json
import os
import re
import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

APPS_DIR = Path(os.environ.get("MOSAIC_APPS_DIR", Path.home() / ".local" / "share" / "mosaic" / "apps"))
APPS_DIR.mkdir(parents=True, exist_ok=True)  # merciful: create once if missing, never touch if present
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

app = FastAPI(title="mosaic", docs_url=None, redoc_url=None)
app.mount("/mosaic/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


def data_updated_at(entry: Path):
    """Most recent mtime among files under entry/data, or None if there is none."""
    data_dir = entry / "data"
    if not data_dir.is_dir():
        return None
    latest = None
    for f in data_dir.rglob("*"):
        if f.is_file():
            mtime = f.stat().st_mtime
            if latest is None or mtime > latest:
                latest = mtime
    return latest


def discover_apps():
    apps = []
    if not APPS_DIR.is_dir():
        return apps
    for entry in sorted(APPS_DIR.iterdir()):
        manifest = entry / "app.json"
        if not (entry.is_dir() and manifest.is_file()):
            continue
        try:
            meta = json.loads(manifest.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if meta.get("id") == entry.name:
            meta["data_updated_at"] = data_updated_at(entry)
            apps.append(meta)
    return apps


def app_dir(app_id: str) -> Path:
    if not ID_RE.match(app_id):
        raise HTTPException(404)
    d = APPS_DIR / app_id
    if not d.is_dir() or not (d / "app.json").is_file():
        raise HTTPException(404, f"app '{app_id}' is not onboarded")
    return d


def resolve_within(root: Path, rel_path: str) -> Path:
    """Resolve rel_path under root; refuse anything that escapes it."""
    root = root.resolve()
    candidate = (root / rel_path).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        raise HTTPException(404)
    return candidate


def resolve_within_for_delete(root: Path, rel_path: str) -> Path:
    """Resolve rel_path under root for deletion: refuse escape, refuse a
    missing target, and refuse the root itself — whole-directory wipe stays
    a deliberate CLI/skill step, never a single call through this route."""
    root = root.resolve()
    candidate = (root / rel_path).resolve()
    if not candidate.is_relative_to(root) or not candidate.exists():
        raise HTTPException(404)
    if candidate == root:
        raise HTTPException(400, "refusing to delete an app's entire data/ directory through this route")
    return candidate


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/mosaic/")


@app.get("/mosaic/health", include_in_schema=False)
def health():
    return {"status": "ok", "apps": len(discover_apps())}


@app.get("/mosaic/", response_class=None)
def dashboard(request: Request):
    return templates.TemplateResponse(
        request, "dashboard.html", {"apps": discover_apps()}
    )


@app.get("/mosaic/apps/{app_id}", include_in_schema=False)
def app_entry_redirect(app_id: str):
    return RedirectResponse(url=f"/mosaic/apps/{app_id}/")


@app.get("/mosaic/apps/{app_id}/", include_in_schema=False)
def app_entry(app_id: str):
    d = app_dir(app_id)
    manifest = json.loads((d / "app.json").read_text())
    entry = manifest.get("entry", "index.html")
    return FileResponse(resolve_within(d / "static", entry))


@app.get("/mosaic/apps/{app_id}/data/{path:path}")
def app_data(app_id: str, path: str):
    d = app_dir(app_id)
    return FileResponse(resolve_within(d / "data", path))


@app.delete("/mosaic/apps/{app_id}/data/{path:path}")
def app_data_delete(app_id: str, path: str):
    d = app_dir(app_id)
    target = resolve_within_for_delete(d / "data", path)
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return {"deleted": path}


@app.get("/mosaic/apps/{app_id}/{path:path}")
def app_static(app_id: str, path: str):
    d = app_dir(app_id)
    return FileResponse(resolve_within(d / "static", path))
