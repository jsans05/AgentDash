import { describe, expect, it } from "vitest";
import { computeSpendReadiness } from "@/lib/firmographics/spend-readiness";
import { EMPTY_COMPANY_FIRMOGRAPHICS } from "@/lib/crm/company-firmographics";
import {
  DEFAULT_BRAND_FILTERS,
  employeeBucketForBrand,
  filterBrands,
  revenueBucketForBrand,
} from "@/lib/market-intel/queries";

describe("computeSpendReadiness", () => {
  it("scores higher for large funded growing brands with Meta ads", () => {
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
    expect(high.spend_readiness_score ?? 0).toBeGreaterThan(low.spend_readiness_score ?? 0);
  });
});

describe("market intel brand filters", () => {
  const brand = {
    key: "acme",
    displayName: "Acme",
    teamPlacements: [{ id: "1", entity_key: "t1", owner_name: "Team A", team_name: null, sponsor_url: null }],
    venuePlacements: [],
  };

  it("filters by revenue bucket", () => {
    const enrichment = {
      annual_revenue: 20_000_000,
    } as const;
    expect(revenueBucketForBrand(enrichment as never)).toBe("10m_50m");
    const filtered = filterBrands(
      [brand],
      "",
      [],
      { ...DEFAULT_BRAND_FILTERS, revenueBuckets: ["10m_50m"] },
      { acme: enrichment as never }
    );
    expect(filtered).toHaveLength(1);
  });

  it("filters by employee bucket", () => {
    const enrichment = {
      estimated_num_employees: 120,
    } as const;
    expect(employeeBucketForBrand(enrichment as never)).toBe("50_200");
    const filtered = filterBrands(
      [brand],
      "",
      [],
      { ...DEFAULT_BRAND_FILTERS, employeeBuckets: ["50_200"] },
      { acme: enrichment as never }
    );
    expect(filtered).toHaveLength(1);
  });
});
