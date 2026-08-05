import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSparklineFromReturns,
  displayStockSymbol,
  stockRangeIsConsistent,
} from "./stock-display.js";

test("displayStockSymbol prefers US quote symbol", () => {
  assert.equal(
    displayStockSymbol({ stock_symbol: "TM", ticker: "7203.T" } as never),
    "TM"
  );
});

test("buildSparklineFromReturns creates oldest-to-newest trend points", () => {
  const points = buildSparklineFromReturns(100, {
    change5d: 5,
    change3m: 10,
    change6m: 8,
    change12m: 20,
  });
  assert.equal(points[points.length - 1], 100);
  assert.ok(points[0] < points[points.length - 1]);
});

test("stockRangeIsConsistent rejects mixed-currency ranges", () => {
  assert.equal(stockRangeIsConsistent(180.34, 2471, 4000), false);
  assert.equal(stockRangeIsConsistent(30, 25.51, 35.72), true);
});
