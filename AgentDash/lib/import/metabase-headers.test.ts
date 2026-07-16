import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { metabaseCreateKey } from "@/lib/import/metabase-workbook";
import {
  normalizeAudienceRow,
  normalizeSocialRow,
} from "@/lib/import/social-audience";

describe("Metabase header aliases", () => {
  it("maps Metabase Owned Social column names", () => {
    const parsed = normalizeSocialRow({
      Name: "Adam LZ",
      "Total Followers": 1000,
      "Avg. ER (20p)": "2.5%",
      "Total Posts": 50,
      "IG Followers": 800,
      "IG ER (20p)": "3.1",
      "IG Total Posts": 40,
      "TT Followers": 200,
      "TT ER (20p)": 1.2,
      "TT Total Posts": 10,
    });
    assert.equal(parsed.name_raw, "Adam LZ");
    assert.equal(parsed.total_followers, 1000);
    assert.equal(parsed.total_lifetime_posts, 50);
    assert.equal(parsed.ig_followers, 800);
    assert.equal(parsed.avg_er_ig_20p, 3.1);
    assert.equal(parsed.ig_lifetime_posts, 40);
    assert.equal(parsed.tt_followers, 200);
    assert.equal(parsed.avg_er_tt_20p, 1.2);
    assert.equal(parsed.tt_lifetime_posts, 10);
  });

  it("maps Metabase Audience column names", () => {
    const parsed = normalizeAudienceRow({
      Name: "Abigail Pawlett",
      "Last Updated": "May 19, 2026",
      "Audience Category": "brands",
      "Audience Name": "Adidas",
      "IG Audience %": "17.38",
      "IG Audience #": 1327,
      "Total IG Followers": 7634,
    });
    assert.equal(parsed.name_raw, "Abigail Pawlett");
    assert.equal(parsed.audience_category, "Brands");
    assert.equal(parsed.audience_name, "Adidas");
    assert.equal(parsed.ig_audience_percent, 17.38);
    assert.equal(parsed.ig_audience_count, 1327);
    assert.equal(parsed.current_ig_following, 7634);
  });

  it("normalizes create keys", () => {
    assert.equal(metabaseCreateKey("Adam LZ"), metabaseCreateKey("adam lz"));
  });
});
