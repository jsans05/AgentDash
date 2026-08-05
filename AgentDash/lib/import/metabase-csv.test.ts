import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { parseMetabaseUploads } from "@/lib/import/metabase-workbook";
import { readXlsxSheetTables } from "@/lib/import/read-xlsx-sheets";

describe("Metabase CSV / mislabeled xlsx", () => {
  it("parses Metabase CSV even when filename ends with .xlsx", async () => {
    const csv = Buffer.from(
      "Name,Agent,Sport\nAbby Winterberger,cwallace@the.team,Track & Field\n"
    );
    const parsed = await parseMetabaseUploads([
      { buffer: csv, fileName: "Roster.xlsx", kindHint: "Roster" },
    ]);
    assert.equal(parsed.sheets.roster, true);
    assert.equal(parsed.roster.length, 1);
    assert.equal(parsed.roster[0]?.display_name, "Abby Winterberger");
    assert.equal(parsed.roster[0]?.file_agent, "cwallace@the.team");
  });

  it("merges separate CSV downloads", async () => {
    const roster = Buffer.from("Name,Agent,Sport\nAdam LZ,danny.talbot@the.team,Motorsports\n");
    const social = Buffer.from(
      "Name,Total Followers,Avg. ER (20p),Total Posts,IG Followers\nAdam LZ,1000,2.5,10,900\n"
    );
    const parsed = await parseMetabaseUploads([
      { buffer: roster, fileName: "roster.csv", kindHint: "Roster" },
      { buffer: social, fileName: "social.csv", kindHint: "Social" },
    ]);
    assert.equal(parsed.sheets.roster, true);
    assert.equal(parsed.sheets.social, true);
    assert.equal(parsed.socialRows.length, 1);
  });

  it("sorts timestamped Metabase download names without hints", async () => {
    const parsed = await parseMetabaseUploads([
      {
        buffer: Buffer.from("Name,Agent,Sport\nAdam LZ,danny.talbot@the.team,Motorsports\n"),
        fileName: "action_sports_roster_2026-07-15T21_50_57.49652517Z.csv",
      },
      {
        buffer: Buffer.from("Name,Total Followers,IG Followers\nAdam LZ,1000,900\n"),
        fileName: "action_sports_owned_social_2026-07-15T21_50_53.148258329Z.csv",
      },
      {
        buffer: Buffer.from(
          "Name,Audience Category,Audience Name,IG Audience %,IG Audience #,Total IG Followers\nAdam LZ,Brands,Adidas,10,90,900\n"
        ),
        fileName: "action_sports___audience_2026-07-15T21_50_47.797345315Z.csv",
      },
    ]);

    assert.deepEqual(parsed.sheets, {
      roster: true,
      social: true,
      audience: true,
    });
  });

  it("reads Metabase ZIP64/data-descriptor xlsx via ExcelJS fallback", async () => {
    const rosterPath = path.join(
      process.env.HOME ?? "",
      "Downloads/action_sports_roster_2026-08-05T21_43_59.557568904Z.xlsx"
    );
    if (!fs.existsSync(rosterPath)) {
      // Local fixture only — skip in CI
      return;
    }
    const buffer = fs.readFileSync(rosterPath);
    const tables = await readXlsxSheetTables(buffer);
    assert.equal(tables.length, 1);
    assert.ok((tables[0]?.rows.length ?? 0) > 1);

    const parsed = await parseMetabaseUploads([
      { buffer, fileName: path.basename(rosterPath) },
    ]);
    assert.equal(parsed.sheets.roster, true);
    assert.ok(parsed.roster.length > 100);
    assert.equal(parsed.roster[0]?.file_agent, "cwallace@the.team");
  });
});
