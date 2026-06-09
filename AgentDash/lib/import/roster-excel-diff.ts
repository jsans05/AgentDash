import { AthleteRosterCache } from "@/lib/import/athlete-roster-cache";
import { isEmptyLastName } from "@/lib/import/name-match";
import type { ExcelTalentRow, ExcelSocialNameRow } from "@/lib/import/parse-talent-workbook";

export type RosterAthleteRow = {
  athlete_id: string;
  first_name: string;
  last_name: string;
  sport: string | null;
  country: string | null;
};

export type ExcelOnlyRow = {
  sheet: "Talent Info" | "Social Data";
  rowIndex: number;
  displayName: string;
  reason: string;
};

export type RosterOnlyRow = RosterAthleteRow & {
  profilePath: string;
};

export type AmbiguousExcelRow = {
  sheet: "Talent Info" | "Social Data";
  rowIndex: number;
  displayName: string;
  candidateIds: string[];
};

export type RosterExcelDiffResult = {
  rosterCount: number;
  excelTalentRowCount: number;
  excelSocialUniqueNames: number;
  matchedPairs: number;
  onlyOnRoster: RosterOnlyRow[];
  onlyInExcel: ExcelOnlyRow[];
  ambiguousExcel: AmbiguousExcelRow[];
  compareSource: "talent_info" | "social_data" | "talent_info_and_social";
};

function matchExcelName(
  roster: AthleteRosterCache,
  displayName: string,
  firstName?: string,
  lastName?: string
) {
  if (firstName !== undefined && lastName !== undefined && isEmptyLastName(lastName)) {
    return roster.resolveOrganization(firstName);
  }
  if (firstName !== undefined && lastName !== undefined && lastName.trim()) {
    return roster.resolveByFirstLast(firstName, lastName);
  }
  return roster.resolveByName(displayName);
}

function diffAgainstExcelRows(
  roster: AthleteRosterCache,
  rosterAthletes: RosterAthleteRow[],
  excelRows: Array<{
    sheet: "Talent Info" | "Social Data";
    rowIndex: number;
    displayName: string;
    first_name?: string;
    last_name?: string;
  }>
): Pick<
  RosterExcelDiffResult,
  "matchedPairs" | "onlyOnRoster" | "onlyInExcel" | "ambiguousExcel"
> {
  const matchedRosterIds = new Set<string>();
  const onlyInExcel: ExcelOnlyRow[] = [];
  const ambiguousExcel: AmbiguousExcelRow[] = [];

  for (const row of excelRows) {
    const resolution = matchExcelName(
      roster,
      row.displayName,
      row.first_name,
      row.last_name
    );

    if (resolution.ambiguous) {
      ambiguousExcel.push({
        sheet: row.sheet,
        rowIndex: row.rowIndex,
        displayName: row.displayName,
        candidateIds: (resolution.candidates ?? []).map((c) => c.athlete_id),
      });
      continue;
    }

    if (!resolution.athlete_id) {
      onlyInExcel.push({
        sheet: row.sheet,
        rowIndex: row.rowIndex,
        displayName: row.displayName,
        reason: "No matching roster profile",
      });
      continue;
    }

    matchedRosterIds.add(resolution.athlete_id);
  }

  const onlyOnRoster: RosterOnlyRow[] = rosterAthletes
    .filter((a) => !matchedRosterIds.has(a.athlete_id))
    .map((a) => ({
      ...a,
      profilePath: `/athlete/${a.athlete_id}`,
    }))
    .sort((a, b) => {
      const an = `${a.last_name} ${a.first_name}`.trim();
      const bn = `${b.last_name} ${b.first_name}`.trim();
      return an.localeCompare(bn);
    });

  onlyInExcel.sort((a, b) => a.displayName.localeCompare(b.displayName));
  ambiguousExcel.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    matchedPairs: matchedRosterIds.size,
    onlyOnRoster,
    onlyInExcel,
    ambiguousExcel,
  };
}

export function compareRosterToWorkbook(
  rosterAthletes: RosterAthleteRow[],
  roster: AthleteRosterCache,
  talentRows: ExcelTalentRow[],
  socialNames: ExcelSocialNameRow[]
): RosterExcelDiffResult {
  const excelRows =
    talentRows.length > 0
      ? talentRows.map((r) => ({
          sheet: r.sheet as "Talent Info",
          rowIndex: r.rowIndex,
          displayName: r.displayName,
          first_name: r.first_name,
          last_name: r.last_name,
        }))
      : socialNames.map((r) => ({
          sheet: r.sheet as "Social Data",
          rowIndex: r.rowIndex,
          displayName: r.displayName,
        }));

  const core = diffAgainstExcelRows(roster, rosterAthletes, excelRows);

  return {
    rosterCount: rosterAthletes.length,
    excelTalentRowCount: talentRows.length,
    excelSocialUniqueNames: socialNames.length,
    compareSource: talentRows.length > 0 ? "talent_info" : "social_data",
    ...core,
  };
}
