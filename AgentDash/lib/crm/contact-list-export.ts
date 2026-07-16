import { contactCategoryLabel, contactStatusLabel, type ContactRow } from "@/lib/crm/contact-filter-sort";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";
import { safeHttpUrl } from "@/lib/security/url";

const EXPORT_COLUMNS = [
  "Name",
  "Company",
  "Category",
  "Role",
  "Email",
  "Phone",
  "LinkedIn",
  "Status",
  "Last Outreach",
] as const;

const COLUMN_WIDTHS: Record<(typeof EXPORT_COLUMNS)[number], number> = {
  Name: 24,
  Company: 28,
  Category: 20,
  Role: 22,
  Email: 30,
  Phone: 16,
  LinkedIn: 36,
  Status: 22,
  "Last Outreach": 14,
};

function exportEmail(row: ContactRow): string {
  if (row.apollo_reveal_status === "pending") return "";
  return row.email ?? "";
}

function exportLinkedin(row: ContactRow): string {
  const url = row.linkedin_url;
  return url && safeHttpUrl(url) ? url : "";
}

function exportLastOutreach(row: ContactRow): string {
  if (!row.last_outreach_at) return "";
  return new Date(row.last_outreach_at).toLocaleDateString();
}

function rowToValues(row: ContactRow): string[] {
  return [
    formatContactDisplayName(row.first_name, row.last_name),
    row.company_name === "—" ? "" : row.company_name,
    contactCategoryLabel(row.category),
    row.role ?? "",
    exportEmail(row),
    row.phone ?? "",
    exportLinkedin(row),
    contactStatusLabel(row.status_tag),
    exportLastOutreach(row),
  ];
}

export async function exportContactsToExcel(options: {
  rows: ContactRow[];
  fileName: string;
  sheetName?: string;
}): Promise<void> {
  const { rows, fileName, sheetName = "Contacts" } = options;
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AgentDash";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = EXPORT_COLUMNS.map((header) => ({
    header,
    width: COLUMN_WIDTHS[header],
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

  for (const row of rows) {
    const excelRow = ws.addRow(rowToValues(row));
    excelRow.alignment = { vertical: "top", wrapText: true };
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
