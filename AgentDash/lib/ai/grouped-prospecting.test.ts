import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupedProspectsMarkdown,
  buildPartnershipJustification,
  flattenGroupedToRows,
  matchScoreOutOf100,
  PROSPECTING_TABLE_HEADER,
  scoreCategoryCandidate,
  type ProspectCategoryCandidate,
} from "@/lib/ai/grouped-prospecting";
import { validateGroupedProspectingOutput } from "@/lib/ai/output-validation";

test("buildGroupedProspectsMarkdown uses four-column contract and score order", () => {
  const grouped: Record<string, ProspectCategoryCandidate[]> = {
    Energy: [
      {
        name: "Low Brand",
        industry: "Energy",
        website: "https://low.example",
        category: "Energy",
        score: 3,
        reason_tags: ["interest match"],
        reason_summary: "Fits Energy",
      },
      {
        name: "Top Brand",
        industry: "Energy",
        website: undefined,
        category: "Energy",
        score: 9,
        reason_tags: ["user request", "brand affinity match"],
        reason_summary: "Fits Energy",
      },
    ],
  };

  const md = buildGroupedProspectsMarkdown({
    athleteName: "Test Athlete",
    grouped,
    minPerCategory: 5,
  });

  assert.ok(md.includes(PROSPECTING_TABLE_HEADER));
  const topIdx = md.indexOf("Top Brand");
  const lowIdx = md.indexOf("Low Brand");
  assert.ok(topIdx >= 0 && lowIdx >= 0);
  assert.ok(topIdx < lowIdx);
  assert.ok(md.includes("| Top Brand | 90 |"));
  assert.ok(md.includes("[low.example](https://low.example)"));
  assert.ok(validateGroupedProspectingOutput(md).ok);
});

test("flattenGroupedToRows preserves match_score and website", () => {
  const rows = flattenGroupedToRows({
    Apparel: [
      {
        name: "Nike",
        industry: "Apparel",
        website: "https://nike.com",
        category: "Apparel",
        score: 7,
        reason_tags: ["brand affinity match"],
        reason_summary: "Fits Apparel",
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.company_name, "Nike");
  assert.equal(rows[0]?.match_score, 70);
  assert.equal(rows[0]?.website, "https://nike.com");
});

test("scoreCategoryCandidate prioritizes user-request categories", () => {
  const result = scoreCategoryCandidate(
    { name: "Acme", category: "Energy Drinks" },
    {
      prioritizedCategories: new Set(["energy drinks"]),
      topInterests: [],
      topBrands: [],
      demographicInferences: [],
    }
  );
  assert.ok(result.score >= 4);
  assert.ok(result.tags.includes("user request"));
});

test("buildPartnershipJustification maps tags to readable copy", () => {
  const text = buildPartnershipJustification({
    name: "Acme",
    industry: "Energy",
    category: "Energy",
    score: 5,
    reason_tags: ["interest match", "demographic fit"],
    reason_summary: "Fits Energy",
  });
  assert.match(text, /interest/i);
  assert.match(text, /demographic/i);
});

test("validateGroupedProspectingOutput rejects legacy three-column tables", () => {
  const legacy = `## Energy
| Brand Name | Brand Description | Reasoning |
| --- | --- | --- |
| Acme | Drinks | Good fit |
`;
  assert.equal(validateGroupedProspectingOutput(legacy).ok, false);
});

test("validateGroupedProspectingOutput rejects non-numeric match scores", () => {
  const bad = `## Energy
${PROSPECTING_TABLE_HEADER}
| --- | --- | --- | --- |
| Acme | ⭐ High | [acme.com](https://acme.com) | Good fit |
`;
  assert.equal(validateGroupedProspectingOutput(bad).ok, false);
});

test("matchScoreOutOf100 maps internal rubric to 0-100", () => {
  assert.equal(matchScoreOutOf100(10), 100);
  assert.equal(matchScoreOutOf100(7), 70);
  assert.equal(matchScoreOutOf100(0), 0);
});
