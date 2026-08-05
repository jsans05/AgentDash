import assert from "node:assert/strict";
import test from "node:test";
import { normalizeManualStockSymbol } from "./correct-stock.js";

test("normalizeManualStockSymbol accepts plain and exchange-qualified symbols", () => {
  assert.equal(normalizeManualStockSymbol("tm"), "TM");
  assert.equal(normalizeManualStockSymbol("TM:NYSE"), "TM");
  assert.equal(normalizeManualStockSymbol("MGDDY:OTCMKTS"), "MGDDY");
  assert.equal(normalizeManualStockSymbol("ML.PA"), "ML.PA");
});

test("normalizeManualStockSymbol rejects invalid input", () => {
  assert.equal(normalizeManualStockSymbol(""), null);
  assert.equal(normalizeManualStockSymbol("not a ticker!"), null);
});
