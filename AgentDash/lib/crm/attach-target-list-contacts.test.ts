import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLeftoverContactsToEmptyOwners,
  leftoverContactIdsToAdopt,
  ownerCompanyKey,
} from "@/lib/crm/attach-target-list-contacts";

test("applyLeftoverContactsToEmptyOwners copies assigner contacts onto empty assignee rows", () => {
  const contacts = new Map<string, string[]>([
    [ownerCompanyKey("admin", "acme"), ["Pat from admin"]],
  ]);
  applyLeftoverContactsToEmptyOwners(
    [{ owner_id: "teammate", company_id: "acme" }],
    contacts
  );
  assert.deepEqual(contacts.get(ownerCompanyKey("teammate", "acme")), ["Pat from admin"]);
});

test("applyLeftoverContactsToEmptyOwners does not overwrite an assignee who already has contacts", () => {
  const contacts = new Map<string, string[]>([
    [ownerCompanyKey("admin", "acme"), ["Pat from admin"]],
    [ownerCompanyKey("teammate", "acme"), ["Alex on teammate"]],
  ]);
  applyLeftoverContactsToEmptyOwners(
    [{ owner_id: "teammate", company_id: "acme" }],
    contacts
  );
  assert.deepEqual(contacts.get(ownerCompanyKey("teammate", "acme")), ["Alex on teammate"]);
});

test("leftoverContactIdsToAdopt moves orphan contacts onto the unique empty owner", () => {
  const adopt = leftoverContactIdsToAdopt(
    [{ owner_id: "teammate", company_id: "acme" }],
    [
      { contact_id: "c1", company_id: "acme", created_by_user_id: "admin" },
      { contact_id: "c2", company_id: "acme", created_by_user_id: "admin" },
    ]
  );
  assert.deepEqual(adopt.get("teammate"), ["c1", "c2"]);
});

test("leftoverContactIdsToAdopt skips companies that already have owner contacts", () => {
  const adopt = leftoverContactIdsToAdopt(
    [{ owner_id: "teammate", company_id: "acme" }],
    [
      { contact_id: "c1", company_id: "acme", created_by_user_id: "admin" },
      { contact_id: "c2", company_id: "acme", created_by_user_id: "teammate" },
    ]
  );
  assert.equal(adopt.size, 0);
});
