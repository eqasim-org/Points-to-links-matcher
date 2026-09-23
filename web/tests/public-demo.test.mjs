import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import initSqlJs from 'sql.js';

const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url));
const network = JSON.parse(read('sample-network.geojson'));
const info = JSON.parse(read('demo-info.json'));
const source = readFileSync(new URL('../app/MapMatcher.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('MapMatcher.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const wanted = new Set(['parseCsv', 'pointsFromCsv', 'normalized', 'gpkgLineString', 'sameRoadGeometry']);
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && wanted.has(n.name?.text)).map(n => n.getText(ast)).join('\n');
const api = vm.runInNewContext(`${ts.transpile(functions, {target:ts.ScriptTarget.ES2022})}; ({pointsFromCsv,gpkgLineString,sameRoadGeometry})`);
const points = api.pointsFromCsv(read('sample-points.csv').toString('utf8'));

test('public example has only three synthetic points and a small clipped geometry-only network', () => {
  assert.equal(points.length, 3);
  assert.equal(network.features.length, info.directed_links);
  assert.ok(network.features.length > 3 && network.features.length < 100);
  assert.ok(read('sample-network.geojson').length < 30000);
  const [west,south,east,north] = info.bounds;
  const inside = ([x,y]) => x >= west && x <= east && y >= south && y <= north;
  const ids = new Set();
  for (const link of network.features) {
    assert.deepEqual(Object.keys(link.properties).sort(), ['__uid','length_m','link_id','name']);
    assert.match(link.properties.link_id, /^DEMO-L\d+$/);
    assert.match(link.properties.name, /^Demo road \d+$/);
    assert.ok(!ids.has(link.properties.link_id)); ids.add(link.properties.link_id);
    assert.equal(link.geometry.type,'LineString');
    assert.ok(link.geometry.coordinates.every(inside));
  }
  for (const point of points) {
    assert.match(point.id, /^DEMO-P\d+$/);
    assert.match(point.properties.notes, /^Synthetic practice point/);
    assert.ok(inside([point.lon,point.lat]));
  }
  assert.ok(network.features.some((a,i) => network.features.slice(i+1).some(b => api.sameRoadGeometry(a,b))), 'demo needs overlapping directions');
});

test('all practice points are close to their suggested link and start unmatched', () => {
  for (const answer of info.suggested_matches) {
    const point = points.find(p => p.id === answer.point_id);
    const link = network.features.find(f => f.properties.link_id === answer.suggested_link_id);
    assert.ok(point && link);
    let closest = Infinity;
    const project = ([x,y]) => [(x-point.lon)*111320*Math.cos(point.lat*Math.PI/180),(y-point.lat)*111320];
    const coords = link.geometry.coordinates.map(project);
    for(let i=1;i<coords.length;i++) {
      const [x,y]=coords[i-1], dx=coords[i][0]-x, dy=coords[i][1]-y;
      const t=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy || 1)));
      closest=Math.min(closest,Math.hypot(x+t*dx,y+t*dy));
    }
    assert.ok(closest < 10, `Point ${point.id} too far from road`);
    assert.equal(point.properties.link_id, undefined);
  }
});

test('downloadable GeoPackage matches the default network and uses the real app geometry parser', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(read('sample-network.gpkg'));
  try {
    assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    assert.deepEqual(db.exec('SELECT geometry_type_name,srs_id FROM gpkg_geometry_columns')[0].values, [['LINESTRING',4326]]);
    const rows = db.exec('SELECT link_id,geom FROM demo_network ORDER BY fid')[0].values;
    assert.equal(rows.length,network.features.length);
    rows.forEach(([id,blob],i) => {
      assert.equal(id,network.features[i].properties.link_id);
      assert.equal(JSON.stringify(api.gpkgLineString(blob)),JSON.stringify(network.features[i].geometry.coordinates));
    });
  } finally { db.close(); }
});
