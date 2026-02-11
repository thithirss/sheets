import { db } from "./db.js";
import { monthStartEnd, todayISO } from "./dates.js";
import { fromCents } from "./money.js";
import type { ExpenseRow } from "./types.js";

export type MonthSummary = {
  month: string;
  from: string;
  to: string;
  total: number;
  averageDaily: number;
  maxExpense: { amount: number; description: string; date: string; category: string } | null;
  projectionEndOfMonth: number;
  byCategory: Array<{ category: string; total: number }>;
  byDay: Array<{ date: string; total: number }>;
  budget: number | null;
  budgetExceeded: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function getMonthSummary(month: string): MonthSummary | null {
  const range = monthStartEnd(month);
  if (!range) return null;

  const totalRow = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE date >= ? AND date <= ?")
    .get(range.from, range.to) as { totalCents: number };

  const maxRow = db
    .prepare("SELECT * FROM expenses WHERE date >= ? AND date <= ? ORDER BY amount_cents DESC LIMIT 1")
    .get(range.from, range.to) as ExpenseRow | undefined;

  const catRows = db
    .prepare(
      "SELECT category, COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE date >= ? AND date <= ? GROUP BY category ORDER BY totalCents DESC"
    )
    .all(range.from, range.to) as Array<{ category: string; totalCents: number }>;

  const dayRows = db
    .prepare(
      "SELECT date, COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date ASC"
    )
    .all(range.from, range.to) as Array<{ date: string; totalCents: number }>;

  const budgetRow = db.prepare("SELECT amount_cents AS amountCents FROM budgets WHERE month = ?").get(month) as
    | { amountCents: number }
    | undefined;

  const total = fromCents(totalRow.totalCents ?? 0);

  const today = todayISO();
  const isCurrentMonth = today.startsWith(month);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysElapsed = isCurrentMonth ? clamp(new Date().getDate(), 1, daysInMonth) : daysInMonth;
  const averageDaily = daysElapsed ? total / daysElapsed : 0;
  const projectionEndOfMonth = isCurrentMonth ? averageDaily * daysInMonth : total;

  const budget = budgetRow ? fromCents(budgetRow.amountCents) : null;
  const budgetExceeded = budget !== null && total > budget;

  return {
    month,
    from: range.from,
    to: range.to,
    total,
    averageDaily,
    maxExpense: maxRow
      ? { amount: fromCents(maxRow.amount_cents), description: maxRow.description, date: maxRow.date, category: maxRow.category }
      : null,
    projectionEndOfMonth,
    byCategory: catRows.map((r) => ({ category: r.category, total: fromCents(r.totalCents) })),
    byDay: dayRows.map((r) => ({ date: r.date, total: fromCents(r.totalCents) })),
    budget,
    budgetExceeded
  };
}

export function getLastMonthsTotals(count: number, untilMonth: string): Array<{ month: string; total: number }> {
  const match = /^(\d{4})-(\d{2})$/.exec(untilMonth);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const end = new Date(year, month - 1, 1);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const totals = new Map<string, number>();
  for (const m of months) totals.set(m, 0);

  const fromRange = monthStartEnd(months[0])!;
  const toRange = monthStartEnd(months[months.length - 1])!;
  const rows = db
    .prepare(
      "SELECT substr(date, 1, 7) AS month, COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE date >= ? AND date <= ? GROUP BY substr(date, 1, 7)"
    )
    .all(fromRange.from, toRange.to) as Array<{ month: string; totalCents: number }>;

  for (const row of rows) totals.set(row.month, fromCents(row.totalCents));

  return months.map((m) => ({ month: m, total: totals.get(m) ?? 0 }));
}
