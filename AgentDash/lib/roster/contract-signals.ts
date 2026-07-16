import { getContractDisplayStatus } from "@/lib/contracts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function contractExpiresWithin90Days(contract: { status: string; end_date: string | null }): boolean {
  const { displayStatus } = getContractDisplayStatus(contract);
  if (displayStatus !== "active" || !contract.end_date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(contract.end_date);
  endDate.setHours(0, 0, 0, 0);
  if (endDate < today) return false;

  const daysUntil = Math.ceil((endDate.getTime() - today.getTime()) / MS_PER_DAY);
  return daysUntil <= 90;
}

export type AthleteContractSignal = {
  active_contract_count: number;
  expiring_contract_count: number;
};

export function buildContractSignalsByAthlete(
  contracts: { athlete_id: string; status: string; end_date: string | null; archived: boolean }[]
): Map<string, AthleteContractSignal> {
  const map = new Map<string, AthleteContractSignal>();

  for (const contract of contracts) {
    if (contract.archived) continue;
    const { displayStatus } = getContractDisplayStatus(contract);
    if (displayStatus !== "active") continue;

    const prev = map.get(contract.athlete_id) ?? { active_contract_count: 0, expiring_contract_count: 0 };
    prev.active_contract_count += 1;
    if (contractExpiresWithin90Days(contract)) {
      prev.expiring_contract_count += 1;
    }
    map.set(contract.athlete_id, prev);
  }

  return map;
}
