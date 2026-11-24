"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { equal, planValue, planCollection } = require("../sync-engine.js");
const row = (grams = 100) => ({ id: "entry-1", grams });
const plan = (base, local, remote) => planCollection({ base, local, remote });

test("unchanged records produce no writes", () => {
  const p = plan([row()], [row()], [row()]);
  assert.equal(p.operations.length, 0);
  assert.equal(p.conflicts.length, 0);
});
test("local edit produces an update with expected cloud value", () => {
  const p = plan([row()], [row(250)], [row()]);
  assert.deepEqual(p.operations, [{ id: "entry-1", action: "update", value: row(250), expected: row() }]);
});
test("local removal produces a guarded deletion", () => {
  const p = plan([row()], [], [row()]);
  assert.equal(p.operations[0].action, "delete");
  assert.deepEqual(p.operations[0].expected, row());
  assert.deepEqual(p.merged, []);
});
test("remote additions are not deleted by an older local snapshot", () => {
  const p = plan([], [], [row()]);
  assert.deepEqual(p.merged, [row()]);
  assert.equal(p.operations.length, 0);
});
test("remote deletion is not resurrected by unchanged local data", () => {
  const p = plan([row()], [row()], []);
  assert.deepEqual(p.merged, []);
  assert.equal(p.operations.length, 0);
});
test("remote edit is accepted if local record is unchanged", () => {
  assert.deepEqual(plan([row()], [row()], [row(300)]).merged, [row(300)]);
});
test("concurrent different edits produce a conflict without a write", () => {
  const p = plan([row()], [row(200)], [row(300)]);
  assert.equal(p.conflicts.length, 1);
  assert.equal(p.operations.length, 0);
  assert.deepEqual(p.conflicts[0], { id: "entry-1", base: row(), local: row(200), remote: row(300) });
});
test("local edit versus remote removal conflicts", () => {
  assert.equal(plan([row()], [row(200)], []).conflicts.length, 1);
});
test("local removal versus remote edit conflicts", () => {
  assert.equal(plan([row()], [], [row(200)]).conflicts.length, 1);
});
test("identical concurrent changes need no write", () => {
  const p = plan([row()], [row(200)], [row(200)]);
  assert.equal(p.operations.length + p.conflicts.length, 0);
});
test("without baseline an absent local row never deletes cloud data", () => {
  assert.equal(plan(null, [], [row()]).operations.length, 0);
});
test("without baseline different values preserve both through a conflict", () => {
  const p = plan(null, [row(200)], [row()]);
  assert.equal(p.conflicts.length, 1);
  assert.equal(p.operations.length, 0);
});
test("new local record produces an insert", () => {
  assert.equal(plan([], [row()], []).operations[0].action, "insert");
});
test("notes use the same three-way update rules", () => {
  assert.equal(planValue({ known: true, base: "old", local: "edited", remote: "old" }).action, "update");
});
test("clearing a goal to null is an update, not a missing value", () => {
  const p = planValue({ known: true, base: 2000, local: null, remote: 2000 });
  assert.equal(p.action, "update");
  assert.equal(p.value, null);
});
test("empty note is a valid update", () => {
  assert.equal(planValue({ known: true, base: "old", local: "", remote: "old" }).action, "update");
});
test("object property ordering does not trigger false changes", () => {
  assert.equal(equal({ id: "a", grams: 100 }, { grams: 100, id: "a" }), true);
});
test("duplicate IDs and invalid JSON numbers are rejected", () => {
  assert.throws(() => plan([], [row(), row()], []), /Duplicate/);
  assert.throws(() => plan([], [{ id: "x", grams: NaN }], []), TypeError);
});
test("missing and partial collection arguments are rejected", () => {
  assert.throws(() => plan(undefined, [], []), TypeError);
  assert.throws(() => plan([], [], null), TypeError);
});
test("planning does not mutate input records or expose shared objects", () => {
  const base = [row()], local = [row(200)], remote = [row()];
  const before = JSON.stringify({ base, local, remote });
  const p = plan(base, local, remote);
  p.merged[0].grams = 999;
  assert.equal(JSON.stringify({ base, local, remote }), before);
});
