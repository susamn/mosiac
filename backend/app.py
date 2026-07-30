"""mosaic — auto-discovering host for skill-produced apps.

Two routes carry every app's own behavior; this host has no per-app logic:
  GET /mosaic/apps/{id}/{path}       static assets (js, css, the app's index.html)
  GET /mosaic/apps/{id}/data/{path}  app-owned data, sub-paths fully app-defined

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


@app.get("/mosaic/apps/{app_id}/{path:path}")
def app_static(app_id: str, path: str):
    d = app_dir(app_id)
    return FileResponse(resolve_within(d / "static", path))
