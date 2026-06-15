const PREFIX = "agentdash.targetList.";

export const TARGET_LIST_FIND_CONTACTS_DISMISS_KEY = `${PREFIX}findContactsConfirmDismissed`;
export const TARGET_LIST_PULL_HQ_PHONE_DISMISS_KEY = `${PREFIX}pullHqPhoneConfirmDismissed`;
export const TARGET_LIST_REVEAL_PHONE_DISMISS_KEY = `${PREFIX}revealPhoneConfirmDismissed`;
export const TARGET_LIST_REMOVE_COMPANY_DISMISS_KEY = `${PREFIX}removeCompanyConfirmDismissed`;
export const TARGET_LIST_REVEAL_CONTACT_DISMISS_KEY = `${PREFIX}revealContactConfirmDismissed`;
export const TARGET_LIST_DELETE_CONTACT_DISMISS_KEY = `${PREFIX}deleteContactConfirmDismissed`;
export const TARGET_LIST_DELETE_CONTACTS_BULK_DISMISS_KEY = `${PREFIX}deleteContactsBulkConfirmDismissed`;

export function isTargetListDialogDismissed(storageKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

export function setTargetListDialogDismissed(storageKey: string, dismissed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (dismissed) {
      window.localStorage.setItem(storageKey, "1");
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // ignore quota / private mode
  }
}
