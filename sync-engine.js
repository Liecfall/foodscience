(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FoodLabSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function canonical(value, seen = new Set()) {
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value !== "object" || seen.has(value)) throw new TypeError("Expected finite, acyclic JSON data");
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new TypeError("Expected a plain JSON object");
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      const items = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(value, i)) throw new TypeError("Sparse arrays are not JSON records");
        items.push(canonical(value[i], seen));
      }
      result = "[" + items.join(",") + "]";
    } else {
      result = "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key], seen)).join(",") + "}";
    }
    seen.delete(value);
    return result;
  }
  const copy = value => value === undefined ? undefined : JSON.parse(canonical(value));
  const equal = (a, b) => a === undefined || b === undefined ? a === b : canonical(a) === canonical(b);
  // Undefined means absent; null is an actual JSON value (for example a cleared goal).
  function planValue({ known, base, local, remote }) {
    for (const value of [base, local, remote]) if (value !== undefined) canonical(value);
    if (typeof known !== "boolean") throw new TypeError("known must be boolean");
    if (equal(local, remote)) return { action: "none", value: copy(remote) };
    if (!known) {
      if (local === undefined) return { action: "none", value: copy(remote) };
      if (remote === undefined) return { action: "insert", value: copy(local), expected: undefined };
      return { action: "conflict", value: copy(local), base: undefined, remote: copy(remote) };
    }
    if (equal(local, base)) return { action: "none", value: copy(remote) };
    if (equal(remote, base)) {
      return { action: local === undefined ? "delete" : remote === undefined ? "insert" : "update", value: copy(local), expected: copy(remote) };
    }
    return { action: "conflict", value: copy(local), base: copy(base), remote: copy(remote) };
  }
  function index(rows, idOf) {
    if (!Array.isArray(rows)) throw new TypeError("Collection must be an array");
    const map = new Map();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError("Record must be an object");
      canonical(row);
      const id = idOf(row);
      if (typeof id !== "string" || !id.trim()) throw new TypeError("Record must have a stable nonempty string ID");
      if (map.has(id)) throw new TypeError("Duplicate record ID: " + id);
      map.set(id, row);
    }
    return map;
  }
  // base=null means no confirmed snapshot. Never infer deletion from absence in that case.
  // remote must be a complete, successfully fetched collection, not a partial API page.
  // Operations are plans only. An adapter must enforce atomic revision checks on writes.
  function planCollection({ base, local, remote, idOf = row => row.id }) {
    if (base !== null && !Array.isArray(base)) throw new TypeError("base must be an array or null");
    if (typeof idOf !== "function") throw new TypeError("idOf must be a function");
    const b = index(base || [], idOf), l = index(local, idOf), r = index(remote, idOf);
    const merged = [], operations = [], conflicts = [];
    for (const id of new Set([...r.keys(), ...l.keys(), ...b.keys()])) {
      const result = planValue({ known: base !== null, base: b.get(id), local: l.get(id), remote: r.get(id) });
      if (result.value !== undefined) merged.push(result.value);
      if (result.action === "conflict") {
        conflicts.push({ id, base: copy(b.get(id)), local: copy(l.get(id)), remote: copy(r.get(id)) });
      } else if (result.action !== "none") {
        operations.push({ id, action: result.action, value: result.value, expected: result.expected });
      }
    }
    return { merged, operations, conflicts };
  }
  return Object.freeze({ canonical, equal, planValue, planCollection });
});
