import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the actual import/parser functions without starting WebGL or a browser.
const source = readFileSync(new URL('../app/MapMatcher.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('MapMatcher.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const wanted = new Set(['togglePointSelection', 'targetsForPoint', 'parsePointGeometry', 'parseCsv', 'pointsFromCsv', 'normalized', 'csvCell', 'addMatches', 'removeMatch', 'pointCollection', 'sameRoadGeometry', 'nextUnmatchedPoint', 'arrowCollection', 'selectedLinkCollection']);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)).map(node => node.getText(ast)).join('\n');
const js = ts.transpile(functions, { target: ts.ScriptTarget.ES2022 });
const api = vm.runInNewContext(`${js}; ({togglePointSelection, targetsForPoint, pointsFromCsv, parseCsv, csvCell, addMatches, removeMatch, pointCollection, sameRoadGeometry, nextUnmatchedPoint, selectedLinkCollection})`);
const mapping = { id: 'Sensor', lon: 'Easting', lat: 'Northing' };

test('WKT geometry import preserves IDs and attributes without coordinate columns', () => {
  const points = api.pointsFromCsv('detid,direction,geometry\n001,North,POINT (6.12 46.2)', {id:'detid',coordinateSource:'geometry',geometry:'geometry'});
  assert.equal(points[0].id, '001');
  assert.equal(points[0].lon, 6.12);
  assert.equal(points[0].lat, 46.2);
  assert.equal(points[0].properties.geometry, 'POINT (6.12 46.2)');
  assert.equal(points[0].properties.direction, 'North');
});

test('WKT accepts whitespace, scientific notation, and explicit WGS84 SRID', () => {
  const points = api.pointsFromCsv('id,geom\na, srid=4326; point ( +6.12e0  4.62e1 ) ', {id:'id',coordinateSource:'geometry',geometry:'geom'});
  assert.equal(points[0].lon, 6.12);
  assert.equal(points[0].lat, 46.2);
});

test('WKT rejects malformed, empty, non-point, projected, and out-of-range values with row numbers', () => {
  for(const geometry of ['', 'POINT EMPTY', 'LINESTRING (6 46)', 'POINT (6 46) trailing', 'POINT (6 46 12)', 'POINT (NaN 46)', 'POINT (6 91)', 'SRID=2056;POINT (6 46)']) {
    assert.throws(() => api.pointsFromCsv('id,geom\na,'+geometry, {id:'id',coordinateSource:'geometry',geometry:'geom'}), /CSV row 2/);
  }
  assert.throws(() => api.pointsFromCsv('id,geom\na,POINT (6 46)', {id:'id',coordinateSource:'geometry',geometry:'missing'}), /Select a geometry column/);
});

test('explicit coordinate choice ignores unused columns in either mode', () => {
  const csv = 'id,lon,lat,geom\na,7,47,POINT (6 46)';
  const mapping = {id:'id',lon:'lon',lat:'lat',geometry:'geom'};
  assert.equal(api.pointsFromCsv(csv, {...mapping,coordinateSource:'columns'})[0].lon, 7);
  assert.equal(api.pointsFromCsv(csv, {...mapping,coordinateSource:'geometry'})[0].lon, 6);
});

const record = uid => ({ link: { type: 'Feature', properties: { __uid: uid, road_id: uid }, geometry: { type: 'LineString', coordinates: [[6, 46], [6.1, 46.1]] } }, matchedAt: '2026-09-22T10:00:00Z' });

test('batch point highlights persist when focus moves and preserve match status', () => {
  const points = ['a','b','c'].map(id => ({id,lon:6,lat:46}));
  const matches = api.addMatches(new Map(), ['a'], [record('one')]);
  const result = api.pointCollection(points, matches, 'c', ['a','b']).features;
  assert.equal(result[0].properties.queued, 1);
  assert.equal(result[1].properties.queued, 1);
  assert.equal(result[2].properties.queued, 0);
  assert.equal(result[0].properties.matched, 1);
  assert.equal(result[1].properties.matched, 0);
  assert.equal(result[2].properties.selected, 1);
  const cleared = api.pointCollection(points, matches, 'c', []).features;
  assert.ok(cleared.every(feature => feature.properties.queued === 0));
});

test('selected link overlay retains all added directions and clears removed links', () => {
  const forward = record('forward').link, reverse = record('reverse').link;
  reverse.geometry.coordinates.reverse();
  const selected = api.selectedLinkCollection([forward,reverse]);
  assert.equal(selected.features.length, 4); // line and arrowhead per direction
  assert.equal(selected.features[0].properties.linkId, 'forward');
  assert.equal(selected.features[2].properties.linkId, 'reverse');
  assert.equal(JSON.stringify(selected.features[0].geometry.coordinates), JSON.stringify(forward.geometry.coordinates));
  assert.equal(JSON.stringify(selected.features[2].geometry.coordinates), JSON.stringify(reverse.geometry.coordinates));
  assert.equal(api.selectedLinkCollection([reverse]).features.length, 2);
  assert.equal(api.selectedLinkCollection([]).features.length, 0);
});

test('direction cycling groups reversed geometry, not unrelated roads at junctions', () => {
  const forward = record('a').link, reverse = record('b').link, other = record('c').link;
  reverse.geometry.coordinates.reverse();
  other.geometry.coordinates[1] = [6.2, 46.2];
  assert.equal(api.sameRoadGeometry(forward, reverse), true);
  assert.equal(api.sameRoadGeometry(forward, other), false);
});

test('next point skips matched points, wraps, respects filtered queue, and finishes', () => {
  const queue = ['a','b','c'].map(id => ({id}));
  const matches = api.addMatches(new Map(), ['b'], [record('link')]);
  assert.equal(api.nextUnmatchedPoint(queue, 'a', matches).id, 'c');
  assert.equal(api.nextUnmatchedPoint(queue, 'c', matches).id, 'a');
  assert.equal(api.nextUnmatchedPoint(queue.slice(1), 'c', api.addMatches(matches, ['c'], [record('link')])), undefined);
  assert.equal(api.nextUnmatchedPoint([], 'a', matches), undefined);
  assert.equal(api.nextUnmatchedPoint(queue, undefined, matches).id, 'a');
});

test('fast confirmation saves the whole group and stays in place without starting another point', () => {
  let node;
  const visit = item => { if (ts.isFunctionDeclaration(item) && item.name?.text === 'confirmInPlace') node = item; ts.forEachChild(item, visit); };
  visit(ast);
  let saved, ended = false, cleared = false;
  const fail = () => {throw new Error('Confirmation must not navigate');};
  const context = { matching:true, mappingDialog:undefined, exportOpen:false, matchTargets:['a','b'], chosenLinks:[record('one').link], candidate:record('two').link, matchesRef:{current:new Map()}, setMatches:value => saved=value, setCheckedPoints:value=>cleared=value.length===0, setMatching:value=>ended=!value, setCandidates:()=>{}, setCandidateId:()=>{}, setChosenLinks:()=>{}, setMatchTargets:()=>{}, startMatchingPoint:fail, setSelectedPointId:fail, mapRef:{current:{easeTo:fail,flyTo:fail}}, setNotice:()=>{} };
  const confirm = vm.runInNewContext(`${js}; ${ts.transpile(node.getText(ast), {target:ts.ScriptTarget.ES2022})}; confirmInPlace`, context);
  confirm();
  assert.equal(saved.get('a').length, 2);
  assert.equal(saved.get('b').length, 2);
  assert.equal(ended, true);
  assert.equal(cleared, true);
  context.candidate = record('one').link;
  confirm();
  assert.equal(saved.get('a').length, 2);
});

test('Ctrl-click toggles batch points and double-click retains the selected group', () => {
  let ids = api.togglePointSelection([], 'a');
  ids = api.togglePointSelection(ids, 'b');
  assert.equal(JSON.stringify(api.targetsForPoint(ids, 'a')), JSON.stringify(['a','b']));
  assert.equal(JSON.stringify(api.targetsForPoint(ids, 'c')), JSON.stringify(['c']));
  ids = api.togglePointSelection(ids, 'a');
  assert.equal(JSON.stringify(ids), JSON.stringify(['b']));
  assert.equal(JSON.stringify(api.targetsForPoint(ids, 'b')), JSON.stringify(['b']));
});

test('batch matching preserves existing pairs and opposite directions, and ignores duplicates', () => {
  const original = api.addMatches(new Map(), ['001'], [record('forward')]);
  const matches = api.addMatches(original, ['001', '002'], [record('forward'), record('reverse')]);
  assert.equal(original.get('001').length, 1);
  assert.equal(matches.size, 2);
  assert.equal(matches.get('001').length, 2);
  assert.equal(matches.get('002').length, 2);
  assert.equal(api.addMatches(matches, ['001'], [record('forward')]).get('001').length, 2);
});

test('removing the final link makes a point unmatched without affecting other points', () => {
  let matches = api.addMatches(new Map(), ['001', '002'], [record('a'), record('b')]);
  matches = api.removeMatch(matches, '001', 'a');
  assert.equal(matches.get('001').length, 1);
  matches = api.removeMatch(matches, '001', 'b');
  assert.equal(matches.has('001'), false);
  assert.equal(matches.get('002').length, 2);
  const features = api.pointCollection([{id:'001',lon:6,lat:46}, {id:'002',lon:6,lat:46}], matches).features;
  assert.equal(features[0].properties.matched, 0);
  assert.equal(features[1].properties.matched, 1);
});

test('actual export emits one row per pair and can restore all associations', () => {
  let exportNode;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'exportMatches') exportNode = node; ts.forEachChild(node, visit); };
  visit(ast);
  const matches = api.addMatches(new Map(), ['001', '002'], [record('a'), record('b')]);
  const context = { points: ['001','002'].map(id => ({id, properties:{Sensor:id}})), matches, exportColumns: [{key:'point:Sensor',header:'Sensor'}, {key:'link:road_id',header:'link_road_id'}, {key:'time',header:'matched_at'}] };
  const run = vm.runInNewContext(`${js}; ${ts.transpile(exportNode.getText(ast), {target:ts.ScriptTarget.ES2022})}; exportMatches`, context);
  const rows = api.parseCsv(run(['point:Sensor','link:road_id','time']));
  assert.equal(rows.length, 5);
  let restored = new Map();
  for (const row of rows.slice(1)) restored = api.addMatches(restored, [row[0]], [record(row[1])]);
  assert.equal(restored.size, 2);
  assert.equal(restored.get('001').length, 2);
  assert.equal(restored.get('002').length, 2);
  assert.equal(rows[1][2], '2026-09-22T10:00:00Z');
});

test('custom columns preserve identifiers, Unicode, quoted commas and multiline attributes', () => {
  const points = api.pointsFromCsv('\uFEFFSensor,Easting,Northing,Street\r\n001,6.12,46.2,"Rue, Genève\nNord"', mapping);
  assert.equal(points[0].id, '001');
  assert.equal(points[0].lon, 6.12);
  assert.equal(points[0].properties.Street, 'Rue, Genève\nNord');
});
test('reject invalid mappings, duplicate IDs, missing coordinates and duplicate columns', () => {
  for (const csv of ['Sensor,Easting,Northing\nA,,46', 'Sensor,Easting,Northing\nA,6,100', 'Sensor,Easting,Northing\nA,6,46\nA,7,47', 'Sensor,Easting,Northing,Sensor\nA,6,46,B']) {
    assert.throws(() => api.pointsFromCsv(csv, mapping));
  }
  assert.throws(() => api.pointsFromCsv('Sensor,Easting,Northing\nA,6,46', { ...mapping, lat: 'Easting' }));
});
test('CSV export escaping round-trips data without changing selected column order', () => {
  const values = ['001', 'Rue "A", Genève', 'North\nSouth', ''];
  const csv = values.map(api.csvCell).join(',');
  assert.equal(JSON.stringify(api.parseCsv(csv)[0]), JSON.stringify(values));
});
