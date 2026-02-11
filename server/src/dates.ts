export function todayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthStartEnd(month: string): { from: string; to: string } | null {
  const match = /^\d{4}-\d{2}$/.exec(month);
  if (!match) return null;
  const [y, m] = month.split("-").map(Number);
  const end = new Date(y, m, 0);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const to = `${y}-${String(m).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return { from, to };
}

export function monthOf(dateISO: string): string | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateISO);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}
