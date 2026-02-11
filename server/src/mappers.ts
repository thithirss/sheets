import { fromCents } from "./money.js";
import type { Expense, ExpenseRow } from "./types.js";

export function mapExpenseRow(row: ExpenseRow): Expense {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    category: row.category,
    amount: fromCents(row.amount_cents),
    source: row.source,
    createdAt: row.created_at
  };
}

