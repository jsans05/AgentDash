import { formatFirmographicsExport } from "@/lib/crm/company-firmographics";
import { formatAgencyActivityExport } from "@/lib/crm/company-agency-activity";
import type { CompanyAgencyActivity } from "@/lib/crm/company-agency-activity";
import type { TargetListContact, TargetListRow } from "@/lib/crm/athlete-target-list";
import type { MasterTargetListAthlete } from "@/lib/crm/master-target-list";
import { targetListColumnWidth } from "@/lib/crm/target-list-column-config";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";
import { safeHttpUrl } from "@/lib/security/url";

const UNCATEGORIZED_LABEL = "Uncategorized";

export type TargetListExportRow = TargetListRow & {
  assigned_athletes?: MasterTargetListAthlete[];
  agency_activity?: CompanyAgencyActivity | null;
};

function formatAthletesExport(athletes: MasterTargetListAthlete[] | undefined): string {
  if (!athletes?.length) return "";
  return athletes
    .map((a) => {
      const score =
        a.match_score != null && Number.isFinite(a.match_score) ? ` (${a.match_score})` : "";
      return `${a.name}${score}`;
    })
    .join(", ");
}

function cellValueForColumn(
  column: string,
  row: TargetListExportRow,
  contact: TargetListContact | null,
  showCategory: boolean,
  showCompany: boolean
): string | number {
  switch (column) {
    case "Category":
      return showCategory ? row.category ?? UNCATEGORIZED_LABEL : "";
    case "Company":
      return showCompany ? row.company_name : "";
    case "Assigned to":
      return showCompany ? (row.is_own !== false ? "You" : row.owner_name || "") : "";
    case "Athletes":
      return showCompany ? formatAthletesExport(row.assigned_athletes) : "";
    case "Company Website":
      return showCompany ? row.website ?? "" : "";
    case "Match Score":
      return showCompany && row.match_score != null ? row.match_score : "";
    case "Contact Name":
      return contact ? formatContactDisplayName(contact.first_name, contact.last_name) : "";
    case "Role":
      return contact?.role ?? "";
    case "Email":
      return contact?.apollo_reveal_status === "pending" ? "" : contact?.email ?? "";
    case "LinkedIn":
      return contact?.linkedin_url && safeHttpUrl(contact.linkedin_url) ? contact.linkedin_url : "";
    case "Number":
      return contact?.phone ?? "";
    case "HQ Number":
      return showCompany ? row.hq_phone ?? "" : "";
    case "Firmographics":
      return showCompany ? formatFirmographicsExport(row) : "";
    case "Agency Activity":
      return showCompany ? formatAgencyActivityExport(row.agency_activity) : "";
    case "Previous Partnerships":
      return showCompany ? row.past_partnerships ?? "" : "";
    case "Company Description":
      return showCompany ? row.company_description ?? "" : "";
    case "Personal Notes":
      return contact?.notes ?? (showCompany ? row.personal_notes ?? "" : "");
    case "Email Subject":
      return (
        contact?.outreach_email_subject ?? (showCompany ? row.outreach_email_subject ?? "" : "")
      );
    case "Outreach Email":
      return contact?.outreach_email ?? (showCompany ? row.outreach_email ?? "" : "");
    default:
      return "";
  }
}

export async function exportTargetListToExcel(options: {
  columns: readonly string[];
  rows: TargetListExportRow[];
  sheetName?: string;
  fileName: string;
}): Promise<void> {
  const { columns, rows, sheetName = "Target List", fileName } = options;
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AgentDash";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = columns.map((h) => ({
    header: h,
    width: targetListColumnWidth(h),
  }));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8E8E8" },
  };
  headerRow.border = {
    bottom: { style: "thin", color: { argb: "FF999999" } },
  };

  const YELLOW_ARGB = "FFFFF3B0";
  let prevCategoryKey: string | null = null;
  let prevCompanyId: string | null = null;

  for (const row of rows) {
    const categoryKey = (row.category ?? UNCATEGORIZED_LABEL).toLowerCase();
    const contacts = row.contacts.length > 0 ? row.contacts : [null];

    contacts.forEach((c, idx) => {
      const showCategory = categoryKey !== prevCategoryKey && idx === 0;
      const showCompany = row.company_id !== prevCompanyId;
      const yellow = c == null;
      const values = columns.map((col) =>
        cellValueForColumn(col, row, c, showCategory, showCompany)
      );
      const excelRow = ws.addRow(values);
      excelRow.alignment = { vertical: "top", wrapText: true };

      if (yellow) {
        for (let col = 2; col <= columns.length; col++) {
          excelRow.getCell(col).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: YELLOW_ARGB },
          };
        }
      }
      if (showCategory) excelRow.getCell(1).font = { bold: true };
      if (showCompany) excelRow.getCell(columns.indexOf("Company") + 1).font = { bold: true };

      prevCategoryKey = categoryKey;
      prevCompanyId = row.company_id;
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
