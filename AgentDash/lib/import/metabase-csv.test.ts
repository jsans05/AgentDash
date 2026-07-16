import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMetabaseUploads } from "@/lib/import/metabase-workbook";

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
});
