import assert from "node:assert/strict";
import test from "node:test";
import { fetchFinnhubMarketData } from "./finnhub.js";
import { scoreFinnhubSearchResult, scoreUsSymbolRow } from "./finnhub.js";

test("scoreFinnhubSearchResult prefers exact company name matches", () => {
  const exact = scoreFinnhubSearchResult(
    { description: "Michelin", type: "Common Stock", symbol: "MGDDY" },
    "Michelin"
  );
  const partial = scoreFinnhubSearchResult(
    { description: "Michelin North America Inc", type: "Common Stock", symbol: "OTHER" },
    "Michelin"
  );
  assert.ok(exact > partial);
});

test("scoreUsSymbolRow ignores ADR listings without name match", () => {
  const unrelated = scoreUsSymbolRow(
    { description: "ASSECO POLAND SA-UNSPON ADR", type: "ADR", symbol: "ASOZY" },
    "Wix Filters"
  );
  const related = scoreUsSymbolRow(
    { description: "MICHELIN (CGDE)-UNSPON ADR", type: "ADR", symbol: "MGDDY" },
    "Michelin"
  );
  assert.equal(unrelated, 0);
  assert.ok(related > 0);
});

test("fetchFinnhubMarketData returns empty for Wix Filters", async () => {
  const hasKey = Boolean(process.env.FINNHUB_API_KEY?.trim());
  if (!hasKey) {
    assert.ok(true);
    return;
  }

  const data = await fetchFinnhubMarketData({
    companyName: "Wix Filters",
    domain: "wixfilters.com",
  });
  assert.equal(data.stock_symbol, null);
  assert.equal(data.share_price, null);
});
