# LinkMatch

A local web app for manually matching CSV points to directed road-network links from a GeoPackage. No accounts, sign-in, or hosted service required.

## Features

- Display points and a road network on an interactive, GPU-rendered map.
- Choose input ID, coordinate, name, and direction columns when importing.
- Match one or several points to one or several directed links.
- Distinguish overlapping opposite-direction links using an arrow preview.
- See each point's attributes while matching; matched points turn green.
- Work quickly with mouse gestures and keyboard shortcuts.
- Export selected point/link attributes as CSV, without geometry, and resume later.

## Quick start

Install **Node.js 22.13 or newer** (including npm), then open a terminal in this repository folder:

```sh
npm ci
npm run local
```

Your default browser opens **http://localhost:3000** automatically once the app is ready. For one-click startup, use `start_linkmatch.bat` on Windows, `start_linkmatch.command` on macOS, or `start_linkmatch.sh` on Linux. These install dependencies if missing. Linux may require **Run in Terminal** or `sh start_linkmatch.sh`; automatic opening needs `xdg-open` and a desktop session. If ZIP extraction loses permissions on macOS/Linux, run `chmod +x start_linkmatch.command start_linkmatch.sh` once. In PowerShell, use `npm.cmd` if script execution policy blocks `npm`. To suppress browser opening, run `npm run local -- --no-open`.

Stop with the **Stop app** button or `Ctrl+C` in the terminal. Keep ports 3000 and 3001 available. The Stop button requires `npm run local`, not `npm run dev`.

The small Geneva demo (54 clipped links and 3 synthetic points) loads initially. See [demo details](docs/DEMO.md). Click **POINTS** and **NETWORK** to load your own files. Point coordinates must be WGS84 longitude/latitude in degrees; network layers must be EPSG:4326, 2D `LINESTRING`, with a unique ID for each directed link.

## Fast matching

| Action | Gesture / shortcut |
| --- | --- |
| Select/deselect a batch point | Ctrl-click on the map (Cmd-click on Mac) |
| Start matching selected group | Release Ctrl and double-click a selected point |
| Preview a directed link | Click a road |
| Cycle overlapping directions | Right-click the map or press `D` |
| Save preview plus added links; keep current view | Shift-click the map or press `Enter` or `Space` |
| Add preview for a multi-link match | Press `A` |
| Cancel pending selection | Press `Esc` |

Confirmation never advances to another point or moves the map. Choose nearby points yourself. For batch matching, Ctrl-click points on the map, then double-click one of them. Sidebar checkboxes and **Match selected points** also remain available. Every selected point is matched to every selected link. Double-clicking an unselected point starts a single-point match instead.

**Automatic local saving:** loaded datasets, column mappings, confirmed matches, pending selections, search, and map position are saved in this browser's IndexedDB. Wait for **Saved on this device** before closing or refreshing. Reopening the same browser profile at `http://localhost:3000` restores that workspace before attempting to load the demo. A second tab is blocked from editing the same workspace to avoid conflicting saves.

**Keep CSV backups too.** Browser data can be cleared or evicted, private browsing is temporary, and other browsers/profiles/origins (including `127.0.0.1` instead of `localhost`) have separate storage. Save failures are shown prominently with a retry button; they do not count as successful autosaves. If restore fails, the saved data is preserved instead of overwritten by the demo. Export one row per point-link pair; keep both ID columns to resume using **Resume matched CSV** on another browser or computer. Chrome and Edge support the Save As picker; other browsers use their download settings.

If the map goes blank after sleep, use **Redraw map** to recreate it without discarding the in-memory workspace. Map graphics are also repainted when the tab becomes visible. This improves recovery but cannot guarantee that a browser/graphics crash never happens. Replacing loaded files replaces the current local workspace; export a backup first. There is currently one autosaved workspace per browser profile and origin, not a project-history manager.

See the [complete user guide](docs/USAGE.md) for imports, exports, direction selection, and resuming work.

## Local operation and data

CSV and GeoPackage uploads are processed in your browser; the app does not upload them to an application server. The background map requests OpenStreetMap tiles, which reveal the viewed map area to the tile service. Initial dependency installation and some build/font operations also need internet access. This is a local tool, not a hardened public hosting service.

The included network is a small real-geometry excerpt with demo-only attributes; the three points are entirely synthetic. Private Geneva/Zurich inputs stay outside `public/` and are ignored by Git. Review upstream geometry redistribution requirements before publishing; see [publication notes](docs/PUBLISHING.md). Do not put private datasets or match exports in `public/`, whose contents are served to the browser.

## Development

```sh
npm test          # Matching, CSV, and fast-navigation regression tests
npm run build    # Production build
npm run dev      # Development server without the Stop app controller
```

The app uses React, TypeScript, MapLibre GL JS, SQL.js, and Vinext/Vite. Dependency versions are recorded in `package-lock.json`. GitHub Actions runs tests and the build on pushes and pull requests; it does not deploy the app.

```text
app/                 Map UI, file dialogs, and styles
docs/                User guide and GitHub publication checklist
public/              Browser assets, SQLite WASM, and Geneva samples
scripts/             Local launcher and optional GeoPackage conversion helper
tests/               Regression tests
types/               Local type declarations
../.github/workflows/ Test/build checks at repository root
start_linkmatch.bat   Windows launcher
```

`build/`, `worker/`, `db/`, `drizzle/`, `examples/`, and `.openai/hosting.json` are inherited framework/deployment scaffolding. They are retained to preserve the working build; local matching does not require a cloud account or database. Full-project `tsc --noEmit` currently reports missing Cloudflare scaffold types; this is separate from the passing app build and regression suite.

## Publishing and licensing

Use [the GitHub publication checklist](docs/PUBLISHING.md). Nothing is published automatically by running the app.

The project has an [MIT license](../LICENSE). Third-party packages and road geometry retain their own terms; see [third-party notes](docs/THIRD_PARTY.md).
