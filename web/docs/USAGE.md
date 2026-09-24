# LinkMatch user guide

## Flexible imports and exports

When loading a point CSV, select the unique point ID, longitude, latitude, and optional street/name and direction columns. Coordinates must be WGS84 longitude/latitude in degrees. Empty or duplicate IDs and invalid coordinates are rejected before replacing the current dataset.

You can also set **Point location source** to **Geometry column (WKT POINT)**, then select the geometry column instead of longitude/latitude columns. Supported values are 2D `POINT (longitude latitude)`, optionally prefixed with `SRID=4326;`. Geometry must already be WGS84; projected geometry, empty points, lines, and polygons are rejected with a CSV row number. Geometry values remain available as point attributes. Switch back to **Longitude + latitude columns** whenever your file uses separate coordinates.

For detector-style files with `detid,Fahrstreif,Fahrtricht,source,geometry`, choose `detid` as ID, `geometry` for location, and `Fahrtricht` as the optional direction description. These names are automatically suggested.

When loading a GeoPackage, choose its EPSG:4326 LINESTRING layer, then a unique directed-link ID column. Geometry is taken from the layer metadata automatically.

Resume matched CSV also lets you select its point ID, link ID and optional timestamp columns. Load the same point and network datasets first.

Export matched CSV opens a column checklist. Select the point attributes, link attributes and timestamp you want, then click Save as to choose a folder and filename in Chrome or Edge. Browsers without a Save As API use normal downloads; enable their “Ask where to save each file” setting to choose a folder. Keep the point ID and link ID in exports you intend to resume later. Link attributes use a `link_` prefix; duplicate output names get a numeric suffix. Geometry is never exported.

Local web app for matching CSV points to directed road-network links from a GeoPackage.

## Start the app

Use `start_linkmatch.bat` on Windows, `start_linkmatch.command` on macOS, or `start_linkmatch.sh` on Linux. Launchers exist both at the repository root and inside `web/`. They install missing dependencies and open your browser when the app is ready. Keep the terminal open. On Linux select **Run in Terminal** if prompted, or run `sh start_linkmatch.sh`. If macOS/Linux reports permission denied after ZIP extraction, run `chmod +x start_linkmatch.command start_linkmatch.sh` once in that folder.

Or open PowerShell in the repository folder and run:

```powershell
npm.cmd run local
```

The browser opens <http://localhost:3000> automatically. No account or sign-in is needed. Use `npm.cmd run local -- --no-open` to suppress browser opening.

## Match points to links

1. The small Geneva network clip and three synthetic practice points load automatically. See [demo details](DEMO.md).
2. To use different files, click the **POINTS** or **NETWORK** file box at the top.
3. Select a point on the map or in the list on the left.
4. Click **Match to links**, or tick several points in the left list and click **Match selected points**.
5. Click the desired road geometry on the map.
6. If opposite-direction links overlap, choose the correct direction using the arrow preview.
7. Click **Add this direction to selection**. Repeat with other links if needed, then click **Confirm**. Every selected point is matched to every selected link.
8. Repeat for the remaining points.
9. Click **Export matched CSV**. Choose columns and save location. There is one row per point-link pair; geometry is excluded.

Adding links preserves previous matches and ignores duplicate pairs. Opposite-direction links remain separate, even when their geometry overlaps. A point stays green as long as it has at least one match. Select a point to see its saved links, preview their arrows, or remove individual matches. Batch checkboxes include selected points hidden by search; use **Clear selection** to reset them.

## Fast mouse and keyboard workflow

During multi-selection, added links stay purple on the map (with direction arrows), and selected points have purple rings and highlighted sidebar rows. The current direction preview is orange-red, separate from the links already added. Point centres remain red/green for unmatched/matched status. Press **A** or **Add this direction to selection** to retain a link before previewing another. Removing a link or clearing point selection removes its batch highlight. Confirming or cancelling clears the pending link overlay; remaining checked points still show their selection rings.

- Ctrl-click points on the map (Cmd-click on Mac) to toggle them into/out of the group. They stay highlighted in purple. Release Ctrl and double-click one of those points to match the whole group. Double-click an unselected point to start a single-point match.
- Click a road to preview its directed link and arrow.
- Right-click anywhere on the map, or press **D**, to cycle directions with the same geometry. This does not select unrelated roads at a junction. Right-drag rotation is disabled.
- **Shift-click on the map**, or press **Enter** or **Space**, to save the previewed link plus any explicitly added links. The map and focused point stay in place; nothing advances automatically. No need to click Add first for a single link.
- Press **A** to add the previewed link when matching several links; click another road and repeat, then confirm with Enter, Space, or Shift-click.
- Press **Esc** to cancel the pending selection without changing saved matches.

A batch confirmation saves all selected point-link combinations and clears the pending selection. Choose the next nearby points yourself. Shortcuts do not run while typing, using buttons, or working in a file dialog. Space is prevented from scrolling when it confirms a map match. Wait for **Saved on this device** before closing or refreshing, and export CSV backups regularly.

## Continue another day

Normally, just start LinkMatch again and open `http://localhost:3000` in the same browser/profile. Your files, column mapping, matches, map position, and pending selection restore automatically. Do not re-upload the original files merely to resume: replacing a dataset starts a replacement workspace and clears its matches (with a confirmation warning).

Local saving is indicated below the header. **Saving locally** means the write has not completed; **Saved on this device** means it has. **AUTOSAVE FAILED** means export a CSV immediately and use Retry save. Refreshing while a save is pending requests a browser leave-page warning where supported. Never rely on a last-second save during shutdown.

If the map goes white, first try **Redraw map**, which retains the current in-memory data. Sleep/tab graphics restoration is handled where possible. If you need to reload, the last completed autosave will be restored. The demo is loaded only if storage contains no workspace; a storage read failure does not silently replace it.

Only one tab can edit the workspace at a time. Close the other tab and click Retry restore if told the workspace is in use. Save data stays on this device; it is not uploaded or committed to Git. Private windows, browser-data cleanup, disk/storage failures, or changing browser/profile/address can make this local copy unavailable. Old work lost before autosave was introduced cannot be reconstructed automatically.

For a separate backup, or moving to another browser/computer:

1. Before stopping, click **Export matched CSV**.
2. Next time, start LinkMatch and load the same full points CSV and network if they are not the included samples.
3. Click **Resume matched CSV** and choose the previously exported file.
4. All point-link pairs are restored, including multiple links for the same point. Existing pairs are preserved and duplicate rows are ignored. Restored points turn green; continue with the remaining red points.

Tip: double-click any point on the map or in the left list to select it and immediately start matching.

Stop the app with the **Stop app** button at the top-right. You can also press `Ctrl+C` in the terminal window.

## Input requirements

- Point CSV: select a unique ID and WGS84 longitude/latitude columns; column names are flexible.
- Network GeoPackage: one EPSG:4326 `LINESTRING` layer.
- An internet connection is only needed for the OpenStreetMap background tiles.
