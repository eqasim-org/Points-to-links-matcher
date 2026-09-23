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
| Start matching a point | Double-click the point |
| Preview a directed link | Click a road |
| Cycle overlapping directions | Right-click the map or press `D` |
| Save preview plus added links; start next unmatched point | Shift-click the map or press `Enter` |
| Add preview for a multi-link match | Press `A` |
| Cancel pending selection | Press `Esc` |

Next-point navigation follows the sidebar order and current search filter. For batch matching, tick points in the sidebar and click **Match selected points**. Every selected point is matched to every selected link.

**Export before closing or refreshing.** Matches are held in browser memory, not automatically saved. Export one row per point-link pair; keep both ID columns to resume later using **Resume matched CSV**. Chrome and Edge support the Save As picker; other browsers use their download settings.

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
