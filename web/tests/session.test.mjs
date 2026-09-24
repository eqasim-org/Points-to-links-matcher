import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/session.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function api(indexedDB, navigator = {}) {
  const context = {exports:{}, indexedDB, navigator};
  vm.runInNewContext(js, context);
  return context.exports;
}
function fixture() {
  const links = ['forward','reverse'].map((id,i) => ({type:'Feature',properties:{__uid:id,link_id:id},geometry:{type:'LineString',coordinates:i ? [[6.1,46.1],[6,46]] : [[6,46],[6.1,46.1]]}}));
  return {points:[{id:'001',lon:6,lat:46,properties:{detid:'001'}}],links,
    matches:new Map([['001',links.map(link => ({link,matchedAt:'2026-09-23T12:00:00Z'}))]]),
    pointFile:'private.csv',networkFile:'private.gpkg',pointMapping:{id:'detid',label:'',direction:''},linkIdColumn:'link_id',
    selectedPointId:'001',search:'001',view:{center:[6,46],zoom:17},checkedPoints:['001'],matchTargets:['001'],
    chosenLinkIds:['forward'],matching:true,candidateIds:['forward','reverse'],candidateId:'reverse'};
}

// Transactional IndexedDB test double: verifies our adapter's transaction boundaries,
// ordering, abort handling and sparse dataset writes without starting a browser.
function fakeIndexedDB() {
  const data = new Map(), writes = [];
  let created = false, failNext = false;
  const db = {
    createObjectStore() {},
    transaction(_name, mode) {
      const operations = [];
      const tx = {objectStore:() => ({
        get(key) { const request = {}; operations.push({kind:'get',key,request}); return request; },
        put(value,key) { operations.push({kind:'put',key,value:structuredClone(value)}); },
      })};
      queueMicrotask(() => {
        if (mode === 'readwrite' && failNext) {
          failNext = false; tx.error = new Error('QuotaExceededError'); tx.onabort?.(); return;
        }
        for(const operation of operations) {
          if(operation.kind === 'get') operation.request.result = structuredClone(data.get(operation.key));
          else { data.set(operation.key, operation.value); writes.push(operation.key); }
        }
        tx.oncomplete?.();
      });
      return tx;
    },
  };
  return {data,writes, fail:() => {failNext = true;}, open() {
    const request = {result:db};
    queueMicrotask(() => {if(!created) {created=true;request.onupgradeneeded?.();}request.onsuccess?.();});
    return request;
  }};
}

test('session round-trip restores all pairs, mappings, leading-zero IDs, drafts and viewport', () => {
  const {encodeSession,decodeSession} = api();
  const original = fixture(), {dataset,progress} = encodeSession(original);
  assert.equal(progress.pairs.length,2);
  assert.equal(progress.pairs[0].link,undefined); // No duplicate geometry per match.
  const restored = decodeSession(structuredClone(dataset),structuredClone(progress));
  assert.equal(restored.matches.get('001').length,2);
  assert.equal(restored.matches.get('001')[0].link,restored.links[0]);
  assert.equal(restored.matches.get('001')[1].matchedAt,'2026-09-23T12:00:00Z');
  assert.equal(JSON.stringify(restored.view),JSON.stringify(original.view));
  assert.equal(restored.pointMapping.id,'detid');
  assert.equal(restored.candidateId,'reverse');
  assert.equal(restored.matching,true);
});

test('missing, unsupported, or inconsistent saved data never silently falls back to demo', () => {
  const {encodeSession,decodeSession} = api();
  assert.equal(decodeSession(),undefined);
  const {dataset,progress} = encodeSession(fixture());
  assert.throws(() => decodeSession(dataset), /incomplete/);
  assert.throws(() => decodeSession({...dataset,version:99},progress), /unsupported/);
  assert.throws(() => decodeSession({...dataset,links:[]},progress), /missing data/);
});

test('new store instance restores saved work; only progress is rewritten after a match or pan', async () => {
  const fake = fakeIndexedDB(), {createSessionStore} = api(fake);
  const store = createSessionStore(), session = fixture();
  assert.equal(await store.load(),undefined);
  await store.save(session);
  await store.save({...session,search:'changed'});
  assert.equal(fake.writes.filter(key => key === 'dataset').length,1);
  const reopened = createSessionStore();
  const restored = await reopened.load();
  assert.equal(restored.search,'changed');
  assert.equal(restored.matches.get('001').length,2);
  await reopened.save({...restored,search:'again'});
  assert.equal(fake.writes.filter(key => key === 'dataset').length,1);
});

test('failed atomic save preserves the previous workspace and permits retry', async () => {
  const fake = fakeIndexedDB(), {createSessionStore} = api(fake);
  const store = createSessionStore(), first = fixture();
  await store.save(first);
  const replacement = {...fixture(),points:[{id:'002',lon:7,lat:47,properties:{}}],matches:new Map(),pointFile:'replacement.csv'};
  fake.fail();
  await assert.rejects(store.save(replacement), /Quota/);
  const previous = await createSessionStore().load();
  assert.equal(previous.pointFile,'private.csv');
  assert.equal(previous.matches.size,1);
  await store.save(replacement);
  assert.equal((await createSessionStore().load()).pointFile,'replacement.csv');
});

test('rapid saves commit in order, so older work cannot overwrite newer work', async () => {
  const fake = fakeIndexedDB(), {createSessionStore} = api(fake), store = createSessionStore(), session = fixture();
  await Promise.all([store.save({...session,search:'first'}),store.save({...session,search:'latest'})]);
  assert.equal((await createSessionStore().load()).search,'latest');
});

test('a second tab cannot obtain the writer lock until the first releases it', async () => {
  let locked = false;
  const navigator = {locks:{request:async (_name,_options,callback) => {
    if(locked) return callback(null);
    locked = true;
    try {await callback({name:'test'});} finally {locked=false;}
  }}};
  const {claimWorkspace} = api(undefined,navigator);
  const release = await claimWorkspace();
  await assert.rejects(claimWorkspace(), /Another LinkMatch tab/);
  release();
  await new Promise(resolve => setImmediate(resolve));
  const releaseAgain = await claimWorkspace();
  releaseAgain();
});
