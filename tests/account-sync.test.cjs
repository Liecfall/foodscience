"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function setup() {
  const context=vm.createContext({setTimeout:()=>0,clearTimeout(){},location:{href:"https://example.test/"}});
  vm.runInContext(`
    globalThis.window=globalThis;
    const memory=new Map();
    globalThis.localStorage={getItem:k=>memory.has(k)?memory.get(k):null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
    globalThis.document={getElementById:()=>null,currentScript:null,documentElement:{lang:'ru'}};
    globalThis.Event=class{};globalThis.CustomEvent=class{};
    globalThis.addEventListener=()=>{};globalThis.dispatchEvent=()=>{};
    globalThis.db={diary_entries:[{user_id:'a',entry_id:'one',data:{id:'one',grams:100},updated_at:'r1',deleted_at:null}],favorites:[{user_id:'a',favorite_key:'catalog:apple',source:'catalog',catalog_product_id:'apple',updated_at:'r1',deleted_at:null}],user_notes:[{user_id:'a',content:'old',updated_at:'r1'}],user_settings:[{user_id:'a',goal:1800,updated_at:'r1'}]};
    globalThis.fail=false;globalThis.race=false;globalThis.inflight=false;globalThis.writes=0;
    let revision=1;
    globalThis.clientMock={from(table){
      let operation='select',payload,filters=[],start=0,end=Infinity;
      const q={select(){return this},eq(k,v){filters.push(r=>r[k]===v);return this},order(){return this},range(a,b){start=a;end=b;return this},update(v){operation='update';payload=v;return this},insert(v){operation='insert';payload=v;return this},then(resolve,reject){
        try{
          if(fail)return Promise.resolve({error:new Error('network'),data:null}).then(resolve,reject);
          if(race && operation==='update'){db[table][0].updated_at='raced';race=false;}
          let rows=db[table].filter(r=>filters.every(f=>f(r)));
          if(operation==='update'){writes++;rows.forEach(r=>Object.assign(r,payload,{updated_at:'r'+(++revision)}));}
          if(operation==='insert'){writes++;const pk=table==='diary_entries'?'entry_id':table==='favorites'?'favorite_key':'user_id';if(db[table].some(r=>r.user_id===payload.user_id&&r[pk]===payload[pk]))return Promise.resolve({error:new Error('duplicate'),data:null}).then(resolve,reject);const r={...payload,updated_at:'r'+(++revision)};db[table].push(r);rows=[r];}
          if(inflight&&operation==='update'){inflight=false;FoodLabStore.setItem('foodlab-nutrition-diary-v1',JSON.stringify({version:2,entries:[{id:'one',grams:350}]}));}
          return Promise.resolve({data:JSON.parse(JSON.stringify(rows.slice(start,end+1))),error:null}).then(resolve,reject);
        }catch(error){return Promise.reject(error).then(resolve,reject);}
      }};return q;
    }};
  `,context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"..","sync-engine.js"),"utf8"),context);
  let source=fs.readFileSync(path.join(__dirname,"..","account.js"),"utf8");
  const marker="  ensureUI();";
  assert.equal(source.split(marker).length,2);
  source=source.replace(marker,"  globalThis.api={syncNow,clearUserCache,onAuthChange,bind(){client=clientMock;user={id:'a'};}};api.bind();return;");
  vm.runInContext(source,context);
  return code=>vm.runInContext(code,context);
}
const setDiary = grams=>`FoodLabStore.setItem('foodlab-nutrition-diary-v1',JSON.stringify({version:2,entries:${grams===null?'[]':`[{id:'one',grams:${grams}}]`}}));`;
test("initial load stores a confirmed baseline",async()=>{const run=setup();assert.equal(await run('api.syncNow()'),true);assert.equal(run("JSON.parse(localStorage.getItem('foodlab-user:a:foodlab-sync-base-v1')).values.diary[0].grams"),100);});
test("existing diary edits reach cloud",async()=>{const run=setup();await run('api.syncNow()');run(setDiary(250));assert.equal(await run('api.syncNow()'),true);assert.equal(run('db.diary_entries[0].data.grams'),250);});
test("diary deletion uses a tombstone",async()=>{const run=setup();await run('api.syncNow()');run(setDiary(null));assert.equal(await run('api.syncNow()'),true);assert.equal(run('!!db.diary_entries[0].deleted_at'),true);});
test("favorite removal is synchronized",async()=>{const run=setup();await run('api.syncNow()');run("FoodLabStore.setItem('foodlab-favorites-v1',JSON.stringify({version:1,items:[]}))");assert.equal(await run('api.syncNow()'),true);assert.equal(run('!!db.favorites[0].deleted_at'),true);});
test("notes and goal can be updated and cleared",async()=>{const run=setup();await run('api.syncNow()');run("FoodLabStore.setItem('foodlab-free-notes-v1','');FoodLabStore.setItem('foodlab-diary-settings-v1',JSON.stringify({goal:null}))");assert.equal(await run('api.syncNow()'),true);assert.equal(run('db.user_notes[0].content'),'');assert.equal(run('db.user_settings[0].goal'),null);});
test("unchanged local record accepts remote update without reverting it",async()=>{const run=setup();await run('api.syncNow()');run("db.diary_entries[0].data.grams=400;db.diary_entries[0].updated_at='remote'");assert.equal(await run('api.syncNow()'),true);assert.equal(run("JSON.parse(FoodLabStore.getItem('foodlab-nutrition-diary-v1')).entries[0].grams"),400);assert.equal(run('db.diary_entries[0].data.grams'),400);});
test("concurrent edits are preserved as a conflict",async()=>{const run=setup();await run('api.syncNow()');run(setDiary(200));run("db.diary_entries[0].data.grams=300;db.diary_entries[0].updated_at='remote'");assert.equal(await run('api.syncNow()'),false);assert.equal(run('db.diary_entries[0].data.grams'),300);assert.equal(run("JSON.parse(FoodLabStore.getItem('foodlab-nutrition-diary-v1')).entries[0].grams"),200);});
test("network errors retain local edits",async()=>{const run=setup();await run('api.syncNow()');run(setDiary(200));run('fail=true');assert.equal(await run('api.syncNow()'),false);assert.equal(run("JSON.parse(FoodLabStore.getItem('foodlab-nutrition-diary-v1')).entries[0].grams"),200);});
test("revision race rejects stale update",async()=>{const run=setup();await run('api.syncNow()');run(setDiary(200));run('race=true');assert.equal(await run('api.syncNow()'),false);assert.equal(run('db.diary_entries[0].data.grams'),100);});
test("editing during a request is kept for the next sync",async()=>{const run=setup();await run('api.syncNow()');run(setDiary(200));run('inflight=true');assert.equal(await run('api.syncNow()'),false);assert.equal(run("JSON.parse(FoodLabStore.getItem('foodlab-nutrition-diary-v1')).entries[0].grams"),350);assert.equal(await run('api.syncNow()'),true);assert.equal(run('db.diary_entries[0].data.grams'),350);});
test("cache cleanup preserves unconfirmed notes",async()=>{const run=setup();run("FoodLabStore.setItem('foodlab-free-notes-v1','unsent')");await run("api.clearUserCache('a')");assert.equal(run("FoodLabStore.getItem('foodlab-free-notes-v1')"),'unsent');});
test("corrupt local JSON blocks writes",async()=>{const run=setup();await run('api.syncNow()');run("FoodLabStore.setItem('foodlab-nutrition-diary-v1','broken')");assert.equal(await run('api.syncNow()'),false);assert.equal(run('writes'),0);});

test("unknown old cache cannot resurrect a deleted cloud record",async()=>{const run=setup();run("db.diary_entries[0].deleted_at='deleted'");run(setDiary(200));assert.equal(await run('api.syncNow()'),false);assert.equal(run('db.diary_entries[0].deleted_at'),'deleted');});
test("switching accounts does not reuse another account's cached diary",async()=>{const run=setup();await run('api.syncNow()');await run("api.onAuthChange({id:'b'})");assert.equal(run("JSON.parse(FoodLabStore.getItem('foodlab-nutrition-diary-v1')).entries.length"),0);assert.equal(run("JSON.parse(localStorage.getItem('foodlab-user:a:foodlab-nutrition-diary-v1')).entries[0].grams"),100);});
