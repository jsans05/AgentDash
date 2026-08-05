"use client";

/**
 * Back-compat export. Prefer importing SequenceCompanyDetails directly.
 * Kept as a real file so Tailwind/Turbopack content watchers don't crash
 * after the rename from SequenceCompanyPanel → SequenceCompanyDetails.
 */
export {
  SequenceCompanyDetails as SequenceCompanyPanel,
  type SequenceCompanyDetailsRow as SequenceCompanyPanelRow,
} from "./SequenceCompanyDetails";
