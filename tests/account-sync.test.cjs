'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run with: node --test tests/account-sync.test.cjs
// Test doubles only: no network calls or real user data.
function setup(seed = {}) {
  const values = new Map();
  const calls = [];
  const tables = structuredClone(seed);
  const uid = 'test-user-a';
  const prefix = 'foodlab-user:' + uid + ':';
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  function from(table) {
    let operation = 'select', payload, filters = [], options;
    const query = {
      select() { return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      is(key, value) { filters.push(row => (row[key] ?? null) === value); return this; },
      in(key, list) { filters.push(row => list.includes(row[key])); return this; },
      maybeSingle() { this.single = true; return this; },
      upsert(data, opts) { operation = 'upsert'; payload = data; options = opts; return this; },
      insert(data) { operation = 'insert'; payload = data; return this; },
      update(data) { operation = 'update'; payload = data; return this; },
      delete() { operation = 'delete'; return this; },
      then(resolve, reject) {
        try {
          calls.push({ table, operation, payload: structuredClone(payload) });
          const rows = tables[table] ||= [];
          const match = row => filters.every(f => f(row));
          let data = rows.filter(match);
          if (operation === 'update') data.forEach(row => Object.assign(row, payload));
          if (operation === 'delete') tables[table] = rows.filter(row => !match(row));
          if (operation === 'upsert' || operation === 'insert') {
            for (const row of Array.isArray(payload) ? payload : [payload]) {
              const fields = options?.onConflict?.split(',') || ['user_id'];
              const old = rows.find(r => fields.every(k => r[k] === row[k]));
              if (old && operation === 'upsert') {
                if (!options?.ignoreDuplicates) Object.assign(old, structuredClone(row));
              } else if (!old) rows.push(structuredClone(row));
            }
          }
          return Promise.resolve({ data: this.single ? data[0] || null : data, error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      }
    };
    return query;
  }
  const window = { addEventListener() {}, dispatchEvent() {} };
  const sandbox = { window, localStorage: storage, document: { getElementById() { return null; }, documentElement: { lang: 'ru' } }, setTimeout, clearTimeout, Event: class {}, CustomEvent: class {} };
  const filename = path.join(__dirname, '..', 'account.js');
  let source = fs.readFileSync(filename, 'utf8');
  const marker = '  ensureUI();';
  assert.equal(source.split(marker).length, 2, 'Account initialization marker must be unique; update test harness if refactored');
  source = source.replace(marker, '  window.__accountTest = { bind(c,u){ client=c; user=u; }, syncDiary, syncFavorites, syncSingletons, clearUserCache }; return;');
  vm.runInNewContext(source, sandbox, { filename });
  const api = window.__accountTest;
  api.bind({ from }, { id: uid });
  return { api, tables, calls, uid, put(key, value) { storage.setItem(prefix + key, value); }, get(key) { return storage.getItem(prefix + key); } };
}

test('editing an existing diary entry updates its cloud payload', async () => {
  const s = setup({ diary_entries: [{ user_id: 'test-user-a', entry_id: 'entry-1', data: { id: 'entry-1', grams: 100 }, deleted_at: null }] });
  s.put('foodlab-nutrition-diary-v1', JSON.stringify({ version: 2, entries: [{ id: 'entry-1', grams: 250 }] }));
  await s.api.syncDiary();
  assert.equal(s.tables.diary_entries[0].data.grams, 250);
});

test('removing a known diary entry removes it from active cloud rows', async () => {
  const s = setup({ diary_entries: [{ user_id: 'test-user-a', entry_id: 'entry-1', data: { id: 'entry-1' }, deleted_at: null }] });
  s.put('foodlab-nutrition-diary-v1', JSON.stringify({ version: 2, entries: [] }));
  await s.api.syncDiary();
  assert.equal(s.tables.diary_entries.filter(r => !r.deleted_at).length, 0);
});

test('removing a known favorite removes it from active cloud rows', async () => {
  const s = setup({ favorites: [{ user_id: 'test-user-a', favorite_key: 'catalog:apple', catalog_product_id: 'apple', deleted_at: null }] });
  s.put('foodlab-favorites-v1', JSON.stringify({ version: 1, items: [] }));
  await s.api.syncFavorites();
  assert.equal(s.tables.favorites.filter(r => !r.deleted_at).length, 0);
});

test('existing notes and calorie goal are updated', async () => {
  const s = setup({ user_notes: [{ user_id: 'test-user-a', content: 'old note' }], user_settings: [{ user_id: 'test-user-a', goal: 1800 }] });
  s.put('foodlab-free-notes-v1', 'edited note');
  s.put('foodlab-diary-settings-v1', JSON.stringify({ goal: 2200 }));
  await s.api.syncSingletons();
  assert.equal(s.tables.user_notes[0].content, 'edited note');
  assert.equal(s.tables.user_settings[0].goal, 2200);
});

test('cache cleanup must not destroy unconfirmed local edits', async () => {
  const s = setup();
  s.put('foodlab-free-notes-v1', 'not confirmed by cloud');
  await s.api.clearUserCache(s.uid);
  assert.equal(s.get('foodlab-free-notes-v1'), 'not confirmed by cloud');
});
