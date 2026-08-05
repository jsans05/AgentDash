import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMetaAdsLibraryUrl,
  extractPageIdFromFacebookHtml,
  scorePageNameMatch,
} from "./ads-library.js";
import {
  collectFacebookPageCandidates,
  pickBestFacebookPageUrl,
  scoreFacebookPageUrl,
} from "./resolve-social.js";

test("scoreFacebookPageUrl prefers global page over regional variant", () => {
  const globalScore = scoreFacebookPageUrl("https://www.facebook.com/Michelin", "Michelin");
  const regionalScore = scoreFacebookPageUrl(
    "https://www.facebook.com/MichelinFrance",
    "Michelin"
  );
  assert.ok(globalScore > regionalScore);
});

test("pickBestFacebookPageUrl selects Michelin over MichelinFrance", () => {
  const best = pickBestFacebookPageUrl(
    [
      "https://www.facebook.com/MichelinFrance",
      "https://www.facebook.com/Michelin",
    ],
    "Michelin"
  );
  assert.equal(best, "https://www.facebook.com/Michelin");
});

test("collectFacebookPageCandidates includes brand slug and instagram handle", () => {
  const candidates = collectFacebookPageCandidates({
    brandName: "Michelin",
    instagramHandle: "michelin",
    facebookPageUrl: "https://www.facebook.com/MichelinFrance",
  });
  assert.ok(candidates.includes("https://www.facebook.com/Michelin"));
  assert.ok(candidates.includes("https://www.facebook.com/michelin"));
  assert.ok(candidates.includes("https://www.facebook.com/michelin"));
  assert.ok(candidates.includes("https://www.facebook.com/MichelinFrance"));
});

test("extractPageIdFromFacebookHtml finds embedded page IDs", () => {
  const html = `<script>{"pageID":"96060366743","name":"Michelin"}</script>`;
  assert.equal(extractPageIdFromFacebookHtml(html), "96060366743");
});

test("scorePageNameMatch ranks exact brand page name highest", () => {
  assert.equal(scorePageNameMatch("Michelin", "Michelin"), 100);
  assert.ok(scorePageNameMatch("Michelin France", "Michelin") < 100);
  assert.equal(scorePageNameMatch("Tire Agent", "Michelin"), 0);
});

test("buildMetaAdsLibraryUrl uses publisher page params", () => {
  const url = buildMetaAdsLibraryUrl("96060366743");
  assert.ok(url.includes("view_all_page_id=96060366743"));
  assert.ok(url.includes("search_type=page"));
  assert.ok(url.includes("is_targeted_country=false"));
  assert.ok(url.includes("sort_data%5Bdirection%5D=desc"));
  assert.ok(url.includes("sort_data%5Bmode%5D=total_impressions"));
});
