import assert from "node:assert/strict";
import test from "node:test";
import { resolveStockParentLookup } from "./stock-parent-map.js";

test("Chevrolet resolves to General Motors ticker GM", () => {
  const lookup = resolveStockParentLookup("Chevrolet", "chevrolet.com");
  assert.equal(lookup.searchName, "General Motors");
  assert.equal(lookup.explicitTicker, "GM");
  assert.equal(lookup.parentCompanyName, "General Motors");
});

test("resolveStockParentLookup leaves standalone public brands unchanged", () => {
  const lookup = resolveStockParentLookup("Toyota", "toyota.com");
  assert.equal(lookup.searchName, "Toyota");
  assert.equal(lookup.explicitTicker, null);
  assert.equal(lookup.parentCompanyName, undefined);
});
