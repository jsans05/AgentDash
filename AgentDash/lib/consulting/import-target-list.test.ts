import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConsultingTargetListColumnMap,
  coerceSpreadsheetCell,
  mapSpreadsheetObjectToImportRow,
  normalizeImportPhone,
  parseConsultingTargetListObjects,
  resolveContactNamesForImport,
} from "@/lib/consulting/import-target-list";

test("normalizeImportPhone strips Excel quote prefix", () => {
  assert.equal(normalizeImportPhone("'+1 951-582-9798"), "+1 951-582-9798");
});

test("mapSpreadsheetObjectToImportRow supports Consulting Upload spreadsheet headers", () => {
  const colMap = buildConsultingTargetListColumnMap([
    "Contact",
    "Title",
    "Email",
    "Company Phone",
    "KEY",
    "Category",
    "Brand",
  ]);
  assert.ok(!("error" in colMap));
  if ("error" in colMap) return;

  const { row } = mapSpreadsheetObjectToImportRow(
    {
      Contact: "Amber McCarthy",
      Title: "Vice President of Sales",
      Email: "amber@aocoolers.com",
      "Company Phone": "'+1 951-582-9798",
      KEY: "NEW",
      Category: "Coolers / Outdoor",
      Brand: "AO Coolers",
    },
    colMap,
    2
  );
  assert.equal(row?.company_name, "AO Coolers");
  assert.equal(row?.email, "amber@aocoolers.com");
  assert.equal(row?.hq_phone, "+1 951-582-9798");
  assert.equal(row?.first_name, "Amber");
  assert.equal(row?.last_name, "McCarthy");
});

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

test("buildConsultingTargetListColumnMap accepts target-list export headers", () => {
  const cols = buildConsultingTargetListColumnMap([
    "Category",
    "Company",
    "Company Website",
    "Contact Name",
    "Role",
    "Email",
    "LinkedIn",
    "Number",
    "HQ Number",
    "Company Phone",
  ]);
  assert.ok(!("error" in cols));
  if ("error" in cols) return;
  assert.equal(cols.companyCol, "Company");
  assert.equal(cols.contactCol, "Contact Name");
  assert.equal(cols.titleCol, "Role");
  assert.equal(cols.emailCol, "Email");
  assert.equal(cols.hqPhoneCol, "HQ Number");
  assert.equal(cols.phoneCol, "Number");
  assert.equal(cols.linkedinCol, "LinkedIn");
});

test("buildConsultingTargetListColumnMap maps Company Phone when HQ Number is absent", () => {
  const cols = buildConsultingTargetListColumnMap([
    "Company",
    "Email",
    "Company Phone",
    "Contact Name",
  ]);
  assert.ok(!("error" in cols));
  if ("error" in cols) return;
  assert.equal(cols.hqPhoneCol, "Company Phone");
});

test("coerceSpreadsheetCell reads hyperlink objects", () => {
  assert.equal(
    coerceSpreadsheetCell({ text: "jane@example.com", hyperlink: "mailto:jane@example.com" }),
    "jane@example.com"
  );
});

test("mapSpreadsheetObjectToImportRow maps Company Phone and Email from export-shaped rows", () => {
  const colMap = buildConsultingTargetListColumnMap([
    "Category",
    "Company",
    "Contact Name",
    "Role",
    "Email",
    "Company Phone",
  ]);
  assert.ok(!("error" in colMap));
  if ("error" in colMap) return;

  const { row, error } = mapSpreadsheetObjectToImportRow(
    {
      Company: "AO Coolers",
      "Contact Name": "Amber McCarthy",
      Role: "VP Sales",
      Email: "amber@aocoolers.com",
      "Company Phone": "555-0100",
    },
    colMap,
    2
  );
  assert.equal(error, undefined);
  assert.ok(row);
  assert.equal(row?.hq_phone, "555-0100");
  assert.equal(row?.email, "amber@aocoolers.com");
});

test("mapSpreadsheetObjectToImportRow imports email without contact name", () => {
  const colMap = buildConsultingTargetListColumnMap(["Company", "Email", "Company Phone"]);
  assert.ok(!("error" in colMap));
  if ("error" in colMap) return;

  const { row } = mapSpreadsheetObjectToImportRow(
    {
      Company: "AO Coolers",
      Email: "amber@aocoolers.com",
      "Company Phone": "555-0100",
    },
    colMap,
    2
  );
  assert.equal(row?.email, "amber@aocoolers.com");
  assert.equal(row?.hq_phone, "555-0100");
  assert.equal(row?.first_name, null);
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
