import assert from "node:assert/strict";
import test from "node:test";
import { computeSpendReadiness } from "./spend-readiness.js";
import { EMPTY_COMPANY_FIRMOGRAPHICS } from "../crm/company-firmographics.js";
import {
  DEFAULT_BRAND_FILTERS,
  employeeBucketForBrand,
  filterBrands,
  revenueBucketForBrand,
} from "../market-intel/queries.js";

test("computeSpendReadiness scores higher for large funded growing brands with Meta ads", () => {
  const high = computeSpendReadiness({
    firmographics: {
      ...EMPTY_COMPANY_FIRMOGRAPHICS,
      annual_revenue: 2_000_000_000,
      total_funding: 100_000_000,
      headcount_twelve_month_growth: 15,
    },
    openJobsCount: 25,
    metaAdsStatus: "active",
    latestFundingRoundDate: new Date().toISOString(),
  });
  const low = computeSpendReadiness({
    firmographics: EMPTY_COMPANY_FIRMOGRAPHICS,
  });
  assert.ok((high.spend_readiness_score ?? 0) > (low.spend_readiness_score ?? 0));
});

test("revenueBucketForBrand filters brands by revenue bucket", () => {
  const brand = {
    key: "acme",
    displayName: "Acme",
    teamPlacements: [
      { id: "1", entity_key: "t1", owner_name: "Team A", team_name: null, sponsor_url: null },
    ],
    venuePlacements: [],
  };
  const enrichment = {
    annual_revenue: 20_000_000,
  } as const;
  assert.equal(revenueBucketForBrand(enrichment as never), "10m_50m");
  const filtered = filterBrands(
    [brand],
    "",
    [],
    { ...DEFAULT_BRAND_FILTERS, revenueBuckets: ["10m_50m"] },
    { acme: enrichment as never }
  );
  assert.equal(filtered.length, 1);
});

test("employeeBucketForBrand filters brands by employee bucket", () => {
  const brand = {
    key: "acme",
    displayName: "Acme",
    teamPlacements: [
      { id: "1", entity_key: "t1", owner_name: "Team A", team_name: null, sponsor_url: null },
    ],
    venuePlacements: [],
  };
  const enrichment = {
    estimated_num_employees: 120,
  } as const;
  assert.equal(employeeBucketForBrand(enrichment as never), "50_200");
  const filtered = filterBrands(
    [brand],
    "",
    [],
    { ...DEFAULT_BRAND_FILTERS, employeeBuckets: ["50_200"] },
    { acme: enrichment as never }
  );
  assert.equal(filtered.length, 1);
});
