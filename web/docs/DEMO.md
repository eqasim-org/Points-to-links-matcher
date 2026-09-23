# Public practice example

The default map loads `public/sample-points.csv` and `public/sample-network.geojson`. The equivalent `public/sample-network.gpkg` is included so users can also try the upload workflow; choose its `demo_network` layer and `link_id` column.

The network contains 54 directed LINESTRINGs clipped to the rectangle from longitude 6.142 to 6.145 and latitude 46.204 to 46.206 (EPSG:4326). Segments crossing the boundary are actually cut, not merely selected by intersection. Opposite directions remain separate. The polygon is available in `public/demo-area.geojson`.

Only geometry was read from the original Geneva network. Original IDs, street names, and other network attributes were not copied. Public link IDs and road labels are synthetic, and `length_m` is an approximate calculated length. The three point records are newly generated practice locations a few metres from roads, not private measurement stations. No real count CSV was used.

## Try these matches

| Synthetic point | Suggested directed link |
| --- | --- |
| DEMO-P001 | DEMO-L040 |
| DEMO-P002 | DEMO-L046 |
| DEMO-P003 | DEMO-L010 |

These suggestions are not preloaded as matches. All three points start red/unmatched. Use the point direction and arrow preview to select a direction. Export and resume with the example CSV and GeoPackage to try the full workflow.

## Reproduce the fixtures

Maintainers with the private source available can run from the repository root:

```sh
python web/scripts/generate_demo.py
```

Uses Python 3.11+ standard-library SQLite serialization and the existing geometry parser; no GIS packages are needed. It reads `geneva/geneva_network.gpkg` in read-only mode and rewrites only the five named public demo fixtures. Users of the app do not need Python or the private source. The exact bounds and suggested pairs are also recorded in `public/demo-info.json`.

The reduced geometry is intentionally public demo material, but clipping and relabeling do not change any upstream geometry licensing requirements. Confirm those separately before publication.
