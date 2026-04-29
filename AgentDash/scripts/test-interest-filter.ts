import { getRelevantAudienceInterests } from "@/lib/ai/getRelevantAudienceInterests";
import { APPROVED_INTEREST_TAXONOMY, industryInterestMap, type IndustryInterestKey } from "@/lib/industry-interest-map";

type IA = { name: string; value: number };

function assert(condition: any, message: string) {
  if (!condition) {
    // eslint-disable-next-line no-console
    console.error("Assertion failed:", message);
    process.exit(1);
  }
}

function assertSubset(used: IA[], allowed: string[]) {
  const allowedSet = new Set(allowed);
  for (const u of used) {
    assert(allowedSet.has(u.name), `Used interest "${u.name}" must be in allowed list`);
  }
}

function testCase(label: string, target: string, interests: IA[]) {
  // eslint-disable-next-line no-console
  console.log(`Running test: ${label}`);
  const res = getRelevantAudienceInterests(target, interests, { maxUsedInterests: 3, debugLog: false });

  // eslint-disable-next-line no-console
  console.log("  industryKey:", res.industryKey);
  // eslint-disable-next-line no-console
  console.log("  usedInterests:", res.usedInterests);
  // eslint-disable-next-line no-console
  console.log("  excludedInterests count:", res.excludedInterests.length);

  assert(res.usedInterests.length <= 3, "Should return at most 3 interests");
  assertSubset(res.usedInterests, res.industryKey ? industryInterestMap[res.industryKey as Exclude<IndustryInterestKey, null>] : []);

  for (const u of res.usedInterests) {
    assert(
      APPROVED_INTEREST_TAXONOMY.includes(u.name),
      `Used interest "${u.name}" must be one of APPROVED_INTEREST_TAXONOMY`
    );
  }

  return res;
}

// 1) fitness brand
testCase("fitness brand", "Fitness recovery supplement brand", [
  { name: "Fitness & Yoga", value: 35 },
  { name: "Healthy Lifestyle", value: 20 },
  { name: "Camera & Photography", value: 12 },
  { name: "Wedding", value: 10 },
]);

// 2) camera brand
testCase("camera brand", "Camera & photography gear", [
  { name: "Camera & Photography", value: 28 },
  { name: "Sports", value: 18 },
  { name: "Electronics & Computers", value: 12 },
  { name: "Wedding", value: 10 },
]);

// 3) beverage brand
testCase("beverage brand", "Coffee, tea and beverages brand", [
  { name: "Coffee, Tea & Beverages", value: 30 },
  { name: "Restaurants, Food & Grocery", value: 20 },
  { name: "Healthy Lifestyle", value: 40 },
  { name: "Beer, Wine & Spirits", value: 15 },
]);

// 4) fashion/accessories brand
testCase("fashion brand", "Luxury fashion apparel brand", [
  { name: "Activewear", value: 10 },
  { name: "Clothes, Shoes, Handbags & Accessories", value: 18 },
  { name: "Jewellery & Watches", value: 22 },
  { name: "Luxury Goods", value: 5 },
]);

// 5) tech brand
testCase("tech brand", "Consumer technology tech company", [
  { name: "Electronics & Computers", value: 25 },
  { name: "Gaming", value: 20 },
  { name: "Business & Careers", value: 15 },
  { name: "Camera & Photography", value: 12 },
]);

// 6) unknown industry => exclude all interests
const unknownRes = getRelevantAudienceInterests("Unknown random industry", [
  { name: "Fitness & Yoga", value: 10 },
  { name: "Healthy Lifestyle", value: 8 },
]);
assert(unknownRes.industryKey === null, "industryKey should be null for unknown industries");
assert(unknownRes.usedInterests.length === 0, "Used interests should be empty when industry is unknown");

// eslint-disable-next-line no-console
console.log("All tests passed.");

