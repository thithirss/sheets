import { monthStartEnd } from "./dates.js";
import { db } from "./db.js";

export function getBudgetState(month: string): { budgetCents: number | null; totalCents: number; exceeded: boolean } | null {
  const range = monthStartEnd(month);
  if (!range) return null;

  const budgetRow = db.prepare("SELECT amount_cents AS amountCents FROM budgets WHERE month = ?").get(month) as
    | { amountCents: number }
    | undefined;

  const totalRow = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE date >= ? AND date <= ?")
    .get(range.from, range.to) as { totalCents: number };

  const budgetCents = budgetRow ? budgetRow.amountCents : null;
  const totalCents = totalRow.totalCents ?? 0;
  const exceeded = budgetCents !== null && totalCents > budgetCents;
  return { budgetCents, totalCents, exceeded };
}

