import assert from "node:assert/strict";
import test from "node:test";
import {
  contactLastNamesLikelyMatch,
  contactsLikelySamePerson,
  findStaleDuplicateContactIds,
} from "@/lib/crm/target-list-duplicate-contacts";
import type { TargetListContactShape } from "@/lib/crm/target-list-contacts";

function contact(
  partial: Partial<TargetListContactShape> & Pick<TargetListContactShape, "contact_id" | "first_name" | "last_name">
): TargetListContactShape {
  return {
    role: null,
    email: null,
    phone: null,
    notes: null,
    linkedin_url: null,
    apollo_person_id: null,
    apollo_reveal_status: null,
    apollo_phone_reveal_status: null,
    ...partial,
  };
}

test("contactLastNamesLikelyMatch links obfuscated Apollo last names", () => {
  assert.equal(contactLastNamesLikelyMatch("McCarthy", "Mc***y"), true);
  assert.equal(contactLastNamesLikelyMatch("Hatch", "Hatch"), true);
  assert.equal(contactLastNamesLikelyMatch("Smith", "Jones"), false);
});

test("findStaleDuplicateContactIds keeps Apollo-linked contact", () => {
  const manual = contact({
    contact_id: "manual",
    first_name: "Amber",
    last_name: "McCarthy",
    role: "Vice President of Sales",
  });
  const apollo = contact({
    contact_id: "apollo",
    first_name: "Amber",
    last_name: "Mc***y",
    role: "Vice President of Sales",
    apollo_person_id: "p1",
    apollo_reveal_status: "revealed",
    email: "amber@aocoolers.com",
  });

  assert.ok(contactsLikelySamePerson(manual, apollo));
  assert.deepEqual(findStaleDuplicateContactIds([manual, apollo]), ["manual"]);
});

test("findStaleDuplicateContactIds skips contacts with outreach drafts", () => {
  const manual = contact({
    contact_id: "manual",
    first_name: "Amber",
    last_name: "McCarthy",
    outreach_email: "Draft body",
  });
  const apollo = contact({
    contact_id: "apollo",
    first_name: "Amber",
    last_name: "Mc***y",
    apollo_person_id: "p1",
    apollo_reveal_status: "revealed",
    email: "amber@aocoolers.com",
  });

  assert.deepEqual(findStaleDuplicateContactIds([manual, apollo]), []);
});
