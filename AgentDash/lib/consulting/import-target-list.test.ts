import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConsultingTargetListColumnMap,
  mapSpreadsheetObjectToImportRow,
  parseConsultingTargetListObjects,
  resolveContactNamesForImport,
} from "@/lib/consulting/import-target-list";

test("buildConsultingTargetListColumnMap accepts Brand as company column", () => {
  const cols = buildConsultingTargetListColumnMap([
    "Industry Category",
    "Brand",
    "HQ Phone",
    "Contact",
    "Title",
    "Email",
  ]);
  assert.ok(!("error" in cols));
  if ("error" in cols) return;
  assert.equal(cols.companyCol, "Brand");
  assert.equal(cols.hqPhoneCol, "HQ Phone");
  assert.equal(cols.contactCol, "Contact");
  assert.equal(cols.titleCol, "Title");
});

test("buildConsultingTargetListColumnMap requires Company or Brand", () => {
  const result = buildConsultingTargetListColumnMap(["Website", "Notes"]);
  assert.ok("error" in result);
  if (!("error" in result)) return;
  assert.match(result.error, /Company or Brand/i);
});

test("resolveContactNamesForImport prefers First and Last over Contact", () => {
  const cols = {
    firstCol: "First",
    lastCol: "Last",
    contactCol: "Contact",
  };
  const resolved = resolveContactNamesForImport(
    { First: "Jane", Last: "Doe", Contact: "Ignored Person" },
    cols
  );
  assert.equal(resolved.first_name, "Jane");
  assert.equal(resolved.last_name, "Doe");
});

test("resolveContactNamesForImport splits Contact when First/Last empty", () => {
  const cols = {
    firstCol: "First",
    lastCol: "Last",
    contactCol: "Contact Name",
  };
  const resolved = resolveContactNamesForImport({ "Contact Name": "Jane Smith" }, cols);
  assert.equal(resolved.first_name, "Jane");
  assert.equal(resolved.last_name, "Smith");
});

test("mapSpreadsheetObjectToImportRow maps HQ phone and contact fields", () => {
  const colMap = buildConsultingTargetListColumnMap([
    "Brand",
    "Category",
    "HQ Number",
    "First",
    "Last",
    "Title",
    "Email",
  ]);
  assert.ok(!("error" in colMap));
  if ("error" in colMap) return;

  const { row, error } = mapSpreadsheetObjectToImportRow(
    {
      Brand: "Alpinestars",
      Category: "Apparel – Moto",
      "HQ Number": "555-0100",
      First: "Alex",
      Last: "Rider",
      Title: "Partnerships",
      Email: "alex@example.com",
    },
    colMap,
    2
  );
  assert.equal(error, undefined);
  assert.ok(row);
  assert.equal(row?.company_name, "Alpinestars");
  assert.equal(row?.industry_category, "Apparel – Moto");
  assert.equal(row?.hq_phone, "555-0100");
  assert.equal(row?.first_name, "Alex");
  assert.equal(row?.role, "Partnerships");
  assert.equal(row?.email, "alex@example.com");
});

test("parseConsultingTargetListObjects skips blank company rows", () => {
  const result = parseConsultingTargetListObjects([
    { Brand: "Good Co", Category: "Tires" },
    { Brand: "", Category: "Skip" },
    { Brand: "Another Co" },
  ]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]?.company_name, "Good Co");
  assert.equal(result.rows[1]?.company_name, "Another Co");
});

test("mapSpreadsheetObjectToImportRow treats invalid match score as parse error", () => {
  const colMap = buildConsultingTargetListColumnMap(["Brand", "Match Score"]);
  assert.ok(!("error" in colMap));
  if ("error" in colMap) return;

  const { row, error } = mapSpreadsheetObjectToImportRow(
    { Brand: "Test Co", "Match Score": "not-a-number" },
    colMap,
    5
  );
  assert.equal(row, null);
  assert.match(error ?? "", /invalid Match Score/i);
});
