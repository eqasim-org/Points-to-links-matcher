# Third-party code and data

- Dependencies and their exact versions are recorded in `package-lock.json`. Consult each package's included license before redistributing it.
- `public/sql-wasm.wasm` is the SQL.js SQLite WebAssembly runtime. Its upstream package is `sql.js`; retain the applicable upstream notices when distributing binaries.
- Background tiles are provided by OpenStreetMap; the map displays attribution. Keep that attribution intact. Tile availability depends on the external service.
- `public/sample-points.csv` contains three generated synthetic points, not original count data. `public/sample-network.geojson` and `public/sample-network.gpkg` contain a small clipped Geneva geometry excerpt, with generated IDs/names and no original attributes. The publisher must confirm the upstream geometry's redistribution and attribution requirements; cropping does not remove those requirements.
- The application's original code is covered by the root MIT `LICENSE`. This does not relicense third-party datasets or dependencies.
