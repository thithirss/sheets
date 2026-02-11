import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { categorizeExpense } from "../categories.js";
import { getBudgetState } from "../budget.js";
import { monthOf, todayISO } from "../dates.js";
import { db } from "../db.js";
import { emitEvent } from "../events.js";
import { mapExpenseRow } from "../mappers.js";
import { parseAmount, toCents } from "../money.js";
import type { ExpenseRow } from "../types.js";

export const devRouter = Router();

const ingestSchema = z.object({
  from: z.string().min(1).optional(),
  text: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

function parseGastoMessage(text: string): { amount: number; description: string } | null {
  const match = /^\s*GASTO\s+([0-9]+(?:[.,][0-9]{1,2})?)\s+(.+?)\s*$/i.exec(text);
  if (!match) return null;
  const amount = parseAmount(match[1]);
  if (amount === null) return null;
  const description = match[2].trim();
  if (!description) return null;
  return { amount, description };
}

devRouter.post("/dev/ingest", (req, res) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() });
    return;
  }

  const gasto = parseGastoMessage(parsed.data.text);
  if (!gasto) {
    res.status(400).json({ error: 'Formato inválido. Use: "GASTO 45.90 Almoço restaurante"' });
    return;
  }

  const date = parsed.data.date ?? todayISO();
  const month = monthOf(date) ?? date.slice(0, 7);
  const beforeBudget = getBudgetState(month);
  const category = categorizeExpense(gasto.description);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(
    "INSERT INTO expenses(id, date, description, category, amount_cents, source, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)"
  ).run(id, date, gasto.description, category, toCents(gasto.amount), "whatsapp", now);

  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as ExpenseRow;
  emitEvent("expense_created", { expense: mapExpenseRow(row) });

  const afterBudget = getBudgetState(month);
  if (beforeBudget && afterBudget && beforeBudget.exceeded !== afterBudget.exceeded) {
    emitEvent("budget_exceeded", { month, exceeded: afterBudget.exceeded });
  }

  res.status(201).json({ item: mapExpenseRow(row) });
});

