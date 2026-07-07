/** Detects the 4-column grouped prospect table from generateAthleteProspectList. */
export function isGroupedProspectingTableHeader(headerCells: string[]): boolean {
  if (headerCells.length !== 4) return false;
  const cells = headerCells.map((c) => c.toLowerCase().trim());
  return (
    cells[0].includes("company") &&
    cells[1].includes("match score") &&
    cells[2].includes("website") &&
    cells[3].includes("partnership justification")
  );
}

export function isTargetListCompactTableContext(
  uiContext?: string
): boolean {
  return (
    uiContext === "target_list" ||
    uiContext === "consulting_target_list" ||
    uiContext === "master_target_list"
  );
}
