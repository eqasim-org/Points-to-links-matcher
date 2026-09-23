import json
import sqlite3
import struct
import sys
from pathlib import Path


ENVELOPE_BYTES = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}


def read_linestring(blob: bytes):
    if blob[:2] != b"GP":
        raise ValueError("Not a GeoPackage geometry")
    flags = blob[3]
    envelope_type = (flags >> 1) & 0b111
    offset = 8 + ENVELOPE_BYTES[envelope_type]
    byte_order = "<" if blob[offset] == 1 else ">"
    geometry_type = struct.unpack_from(f"{byte_order}I", blob, offset + 1)[0]
    if geometry_type % 1000 != 2:
        raise ValueError(f"Expected LINESTRING, found WKB type {geometry_type}")
    count = struct.unpack_from(f"{byte_order}I", blob, offset + 5)[0]
    cursor = offset + 9
    coordinates = []
    for _ in range(count):
        x, y = struct.unpack_from(f"{byte_order}dd", blob, cursor)
        coordinates.append([x, y])
        cursor += 16
    return coordinates


def main(source: Path, target: Path):
    connection = sqlite3.connect(source)
    geometry_row = connection.execute(
        "SELECT table_name, column_name FROM gpkg_geometry_columns LIMIT 1"
    ).fetchone()
    if not geometry_row:
        raise RuntimeError("No geometry table found")
    table, geometry_column = geometry_row
    columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
    attribute_columns = [column for column in columns if column != geometry_column]
    select_columns = ", ".join(f'"{column}"' for column in attribute_columns)
    query = f'SELECT {select_columns}, "{geometry_column}" FROM "{table}"'

    features = []
    for row in connection.execute(query):
        properties = dict(zip(attribute_columns, row[:-1]))
        features.append(
            {
                "type": "Feature",
                "id": properties.get("fid"),
                "properties": properties,
                "geometry": {
                    "type": "LineString",
                    "coordinates": read_linestring(row[-1]),
                },
            }
        )

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Converted {len(features)} links from {table} to {target}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
