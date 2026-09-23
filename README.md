# Points-to-links matcher (LinkMatch)

A local web app to match CSV points to directed road links from a GeoPackage. No accounts required. Supports overlapping directions, multiple point-link matches, and resumable CSV exports.

## Run locally

Install Node.js 22.13 or newer, then double-click `start_linkmatch.bat` on Windows, or run:

```sh
cd web
npm ci
npm run local
```

Open http://localhost:3000. Stop with **Stop app** or `Ctrl+C`. Export your matches before closing or refreshing.

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
