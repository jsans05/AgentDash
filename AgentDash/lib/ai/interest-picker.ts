import {
  APPROVED_INTEREST_CATEGORIES,
  type ApprovedInterestCategory,
} from "@/lib/ai/interest-taxonomy";
import type { UserQuestionOption } from "@/lib/ai/user-question";

/** Canonical interest count + optional "Something else" row in the picker UI. */
export const INTEREST_PICKER_OPTION_CAP = APPROVED_INTEREST_CATEGORIES.length + 1;

export function isInterestCategoryPickerQuestion(question: string): boolean {
  const q = String(question ?? "").toLowerCase();
  return (
    /audience interest categor/.test(q) ||
    /interest categor(y|ies).*(relevant|fit|pitch|best)/.test(q) ||
    /which interest categor/.test(q)
  );
}

/** Full canonical taxonomy; preferred labels (e.g. curation) appear first, remainder A→Z. */
export function buildFullInterestPickerOptions(preferredFirst: string[] = []): UserQuestionOption[] {
  const canon = new Set<string>(APPROVED_INTEREST_CATEGORIES);
  const ordered: ApprovedInterestCategory[] = [];

  for (const raw of preferredFirst) {
    const label = String(raw ?? "").trim();
    if (!label || !canon.has(label)) continue;
    const cat = label as ApprovedInterestCategory;
    if (!ordered.includes(cat)) ordered.push(cat);
  }

  for (const cat of APPROVED_INTEREST_CATEGORIES) {
    if (!ordered.includes(cat)) ordered.push(cat);
  }

  return ordered.map((label) => ({ id: label, label }));
}

/** Expand partial model-chosen interest lists to the full canonical catalog. */
export function expandInterestPickerOptionsIfNeeded(
  question: string,
  options: UserQuestionOption[]
): UserQuestionOption[] {
  if (!isInterestCategoryPickerQuestion(question)) return options;

  const canon = new Set<string>(APPROVED_INTEREST_CATEGORIES);
  const allCanonical = options.every((o) => o.id === o.label && canon.has(o.id));
  const partialCanonical =
    options.length > 0 &&
    options.length < APPROVED_INTEREST_CATEGORIES.length &&
    allCanonical;

  if (!partialCanonical) return options;

  const preferred = options.map((o) => o.label);
  return buildFullInterestPickerOptions(preferred);
}
