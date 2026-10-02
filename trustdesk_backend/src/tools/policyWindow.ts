/** Policy windows are always measured from the ticket timestamp, never the wall clock. */
export function dateOnly(iso: string | Date): string {
  if (iso instanceof Date) return iso.toISOString().slice(0, 10);
  return String(iso).slice(0, 10);
}

export function isReturnWindowOpen(ticketCreatedAt: string, eligibleReturnUntil: string | null): boolean {
  if (!eligibleReturnUntil) return false;
  return dateOnly(ticketCreatedAt) <= eligibleReturnUntil.slice(0, 10);
}

export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

export function isWarrantyOpen(input: {
  ticketCreatedAt: string;
  deliveredAt: string | null;
  tier: string | null;
}): boolean {
  if (!input.deliveredAt) return false;
  const months = (input.tier ?? "").toLowerCase() === "gold" ? 18 : 12;
  const until = addMonths(input.deliveredAt, months);
  return dateOnly(input.ticketCreatedAt) <= until;
}
