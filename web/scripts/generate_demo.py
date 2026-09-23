"""Generate public demo fixtures from geometry only; never read private point data.

Run from the repository root: python web/scripts/generate_demo.py
Outputs replace only the named demo fixtures in web/public.
"""
import csv
import json
import math
import sqlite3
import struct
from pathlib import Path

from convert_gpkg import read_linestring

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "web" / "public"
BOUNDS = (6.142, 46.204, 6.145, 46.206)  # lon/lat rectangle, about 231 x 222 m


def segment_clip(a, b):
    """Liang-Barsky clipping; retain original travel direction."""
    west, south, east, north = BOUNDS
    dx, dy = b[0] - a[0], b[1] - a[1]
    low, high = 0.0, 1.0
    for p, q in zip((-dx, dx, -dy, dy), (a[0]-west, east-a[0], a[1]-south, north-a[1])):
        if p == 0:
            if q < 0:
                return None
        elif p < 0:
            low = max(low, q / p)
        else:
            high = min(high, q / p)
        if low >= high:
            return None
    return [[round(a[0]+t*dx, 9), round(a[1]+t*dy, 9)] for t in (low, high)]


def clip_line(coords):
    parts, current = [], []
    for a, b in zip(coords, coords[1:]):
        clipped = segment_clip(a, b)
        if clipped is None:
            if current:
                parts.append(current)
                current = []
            continue
        if current and current[-1] == clipped[0]:
            current.append(clipped[1])
        else:
            if current:
                parts.append(current)
            current = clipped
    if current:
        parts.append(current)
    return parts


def distance(a, b):
    return math.hypot((b[0]-a[0])*111320*math.cos(math.radians(46.205)), (b[1]-a[1])*111320)


def length(coords):
    return sum(distance(a, b) for a, b in zip(coords, coords[1:]))


def midpoint(coords):
    remaining = length(coords)/2
    for a, b in zip(coords, coords[1:]):
        size = distance(a, b)
        if size >= remaining and size:
            return [a[i]+(b[i]-a[i])*remaining/size for i in range(2)]
        remaining -= size
    return coords[-1]


def main():
    source = ROOT / "geneva" / "geneva_network.gpkg"
    database = sqlite3.connect(source.as_uri()+"?mode=ro", uri=True)
    try:
        table, column, srs, kind = database.execute("SELECT table_name,column_name,srs_id,geometry_type_name FROM gpkg_geometry_columns LIMIT 1").fetchone()
        if srs != 4326 or kind != "LINESTRING":
            raise ValueError("Expected a WGS84 LINESTRING source")
        quote = lambda name: '"'+name.replace('"', '""')+'"'
        # Only geometry is selected. Original IDs, names, counts and attributes never enter the demo.
        lines = [part for (blob,) in database.execute(f"SELECT {quote(column)} FROM {quote(table)}") if blob
                 for part in clip_line(read_linestring(blob)) if length(part) >= 2]
    finally:
        database.close()
    lines.sort(key=lambda coords: tuple(map(tuple, coords)))
    groups, features = {}, []
    for index, coords in enumerate(lines, 1):
        key = min(tuple(map(tuple, coords)), tuple(map(tuple, reversed(coords))))
        road = groups.setdefault(key, len(groups)+1)
        uid = f"DEMO-L{index:03}"
        features.append({"type":"Feature", "id":uid, "properties":{
            "__uid":uid, "link_id":uid, "name":f"Demo road {road:02}", "length_m":round(length(coords), 1)
        }, "geometry":{"type":"LineString", "coordinates":coords}})
    assert features, "Empty clip"
    # Pick separated roads, preferring a reversed pair to demonstrate direction selection.
    candidates = sorted(features, key=lambda f: (-sum(g['properties']['name'] == f['properties']['name'] for g in features), -f['properties']['length_m']))
    chosen = []
    for feature in candidates:
        position = midpoint(feature['geometry']['coordinates'])
        if feature['properties']['length_m'] < 20:
            continue
        if all(distance(position, midpoint(other['geometry']['coordinates'])) > 45 for other in chosen):
            chosen.append(feature)
        if len(chosen) == 3:
            break
    assert len(chosen) == 3, "Need three separated demo roads"
    points, answers = [], []
    for i, feature in enumerate(chosen, 1):
        coords = feature['geometry']['coordinates']
        lon, lat = midpoint(coords)
        lon = min(BOUNDS[2]-0.00001, max(BOUNDS[0]+0.00001, lon+0.000025))
        lat = min(BOUNDS[3]-0.00001, max(BOUNDS[1]+0.00001, lat+0.00002))
        angle = math.degrees(math.atan2((coords[-1][0]-coords[0][0])*math.cos(math.radians(lat)), coords[-1][1]-coords[0][1])) % 360
        direction = ['north','northeast','east','southeast','south','southwest','west','northwest'][int((angle+22.5)//45)%8]
        points.append([f"DEMO-P{i:03}", feature['properties']['name'], f"Toward {direction}", round(lat, 8), round(lon, 8), "Synthetic practice point; not a real count station"])
        answers.append({"point_id":points[-1][0], "suggested_link_id":feature['properties']['link_id']})
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT/'sample-network.geojson').write_text(json.dumps({"type":"FeatureCollection", "features":features}, separators=(',', ':'))+'\n', encoding='utf-8')
    with (OUTPUT/'sample-points.csv').open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream)
        writer.writerow(['counter_id','nom_voie','direction','lat','lon','notes'])
        writer.writerows(points)
    west, south, east, north = BOUNDS
    (OUTPUT/'demo-area.geojson').write_text(json.dumps({"type":"Feature", "properties":{"name":"Geneva demo clipping polygon"}, "geometry":{"type":"Polygon", "coordinates":[[[west,south],[east,south],[east,north],[west,north],[west,south]]]}}, indent=2)+'\n', encoding='utf-8')
    (OUTPUT/'demo-info.json').write_text(json.dumps({"bounds":BOUNDS,"directed_links":len(features),"points":3,"synthetic_point_data":True,"original_network_attributes_included":False,"suggested_matches":answers}, indent=2)+'\n', encoding='utf-8')
    # Build a fresh SQLite container in memory so old private pages cannot survive in the public GPKG.
    gpkg = sqlite3.connect(':memory:')
    gpkg.executescript('''
      PRAGMA application_id=1196444487; PRAGMA user_version=10300;
      CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL,srs_id INTEGER PRIMARY KEY,organization TEXT NOT NULL,organization_coordsys_id INTEGER NOT NULL,definition TEXT NOT NULL,description TEXT);
      INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined Cartesian',-1,'NONE',-1,'undefined',''),('Undefined geographic',0,'NONE',0,'undefined','');
      INSERT INTO gpkg_spatial_ref_sys VALUES ('WGS 84',4326,'EPSG',4326,'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]','');
      CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY,data_type TEXT NOT NULL,identifier TEXT UNIQUE,description TEXT DEFAULT '',last_change DATETIME NOT NULL DEFAULT '2026-09-23T00:00:00.000Z',min_x DOUBLE,min_y DOUBLE,max_x DOUBLE,max_y DOUBLE,srs_id INTEGER);
      CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL,column_name TEXT NOT NULL,geometry_type_name TEXT NOT NULL,srs_id INTEGER NOT NULL,z TINYINT NOT NULL,m TINYINT NOT NULL,PRIMARY KEY(table_name,column_name));
      CREATE TABLE demo_network (fid INTEGER PRIMARY KEY,link_id TEXT UNIQUE,name TEXT,length_m REAL,geom BLOB);
      INSERT INTO gpkg_geometry_columns VALUES ('demo_network','geom','LINESTRING',4326,0,0);
    ''')
    gpkg.execute("INSERT INTO gpkg_contents(table_name,data_type,identifier,min_x,min_y,max_x,max_y,srs_id) VALUES ('demo_network','features','Geneva demo',?,?,?,?,4326)", BOUNDS)
    for i, feature in enumerate(features, 1):
        props, coords = feature['properties'], feature['geometry']['coordinates']
        blob = b'GP'+bytes([0,1])+struct.pack('<i',4326)+struct.pack('<BII',1,2,len(coords))+b''.join(struct.pack('<dd',*p) for p in coords)
        gpkg.execute('INSERT INTO demo_network VALUES (?,?,?,?,?)', (i,props['link_id'],props['name'],props['length_m'],blob))
    gpkg.commit()
    (OUTPUT/'sample-network.gpkg').write_bytes(gpkg.serialize())
    gpkg.close()
    print(f"Generated {len(features)} directed links, 3 synthetic points, and the demo polygon.")


if __name__ == '__main__':
    main()
