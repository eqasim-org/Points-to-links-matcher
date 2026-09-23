# Points-to-links matcher (LinkMatch)

A local web app to match CSV points to directed road links from a GeoPackage. No accounts required. Supports overlapping directions, multiple point-link matches, and resumable CSV exports.

## Run locally

Install Node.js 22.13 or newer (including npm), then use the launcher for your system:

| System | Launcher |
| --- | --- |
| Windows | Double-click `start_linkmatch.bat` |
| macOS | Double-click `start_linkmatch.command` |
| Linux | Run `start_linkmatch.sh` (choose **Run in Terminal** if your file manager asks) |

The launcher installs missing dependencies and opens your default browser automatically once the app is ready. Keep its terminal open while using the app. Linux needs a desktop environment and `xdg-open` for automatic browser opening.

If a downloaded ZIP loses executable permissions on macOS/Linux, run `chmod +x start_linkmatch.command start_linkmatch.sh` once from the repository folder. Linux file managers differ: if double-click opens an editor, use `sh start_linkmatch.sh` in a terminal instead.

Alternatively, start from a terminal:

```sh
cd web
npm ci
npm run local
```

Your browser opens at http://localhost:3000 automatically. Stop with **Stop app** or `Ctrl+C`. Export your matches before closing or refreshing. Use `npm run local -- --no-open` inside `web/` if you do not want a browser window.

## Included practice example

The app opens with **3 synthetic points and 54 directed road links**, clipped from Geneva to a rectangle about **230 by 220 metres**. Only road geometry is retained from the original network; all IDs/names are demo labels. No private count records or original network attributes are included.

- [Example points CSV](web/public/sample-points.csv)
- [Example network GeoPackage](web/public/sample-network.gpkg)
- [Clipping polygon](web/public/demo-area.geojson)
- [Example details and suggested matches](web/docs/DEMO.md)

Double-click a point, click a road, right-click to switch direction, then Shift-click or press Enter to save and move to the next point. Upload your own points/network using the file buttons.

## Repository layout

- `web/`: application, browser demo fixtures, tests, and detailed documentation.
- `.github/workflows/`: tests/build automation for the application.
- `LICENSE`: project MIT license; source road geometry retains any applicable upstream terms.

See the [application README](web/README.md), [user guide](web/docs/USAGE.md), and [publication checklist](web/docs/PUBLISHING.md).

The original private data folders, GeoPackages, working CSVs, and archives are ignored. Only the explicitly named demo data files are allowed into Git. Do not add private data using `git add -f` or place it under another unignored filename. The demo's road geometry is a real Geneva excerpt; confirm any upstream redistribution requirements before public release.
