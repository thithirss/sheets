import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { categorizeExpense } from "../categories.js";
import { monthOf, monthStartEnd } from "../dates.js";
import { getBudgetState } from "../budget.js";
import { db } from "../db.js";
import { emitEvent } from "../events.js";
import { mapExpenseRow } from "../mappers.js";
import { parseAmount, toCents } from "../money.js";
import { getLastMonthsTotals, getMonthSummary } from "../stats.js";
import type { ExpenseRow } from "../types.js";

export const expensesRouter = Router();

const expenseCreateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount: z.number().positive(),
  category: z.string().optional()
});

const expenseUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  category: z.string().min(1).optional()
});

expensesRouter.get("/expenses", (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const min = typeof req.query.min === "string" ? parseAmount(req.query.min) : null;
  const max = typeof req.query.max === "string" ? parseAmount(req.query.max) : null;

  const range = month ? monthStartEnd(month) : from && to ? { from, to } : null;
  if (!range) {
    res.status(400).json({ error: "Informe month=YYYY-MM ou from/to (YYYY-MM-DD)." });
    return;
  }

  const where: string[] = ["date >= ? AND date <= ?"];
  const params: Array<string | number> = [range.from, range.to];
  if (category) {
    where.push("category = ?");
    params.push(category);
  }
  if (min !== null) {
    where.push("amount_cents >= ?");
    params.push(toCents(min));
  }
  if (max !== null) {
    where.push("amount_cents <= ?");
    params.push(toCents(max));
  }

  const sql = `SELECT * FROM expenses WHERE ${where.join(" AND ")} ORDER BY date DESC, created_at DESC`;
  const rows = db.prepare(sql).all(...params) as ExpenseRow[];
  res.json({ items: rows.map(mapExpenseRow) });
});

expensesRouter.post("/expenses", (req, res) => {
  const parsed = expenseCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() });
    return;
  }

  const category = parsed.data.category?.trim() ? parsed.data.category.trim() : categorizeExpense(parsed.data.description);
  const month = monthOf(parsed.data.date) ?? parsed.data.date.slice(0, 7);
  const beforeBudget = getBudgetState(month);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(
    "INSERT INTO expenses(id, date, description, category, amount_cents, source, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)"
  ).run(id, parsed.data.date, parsed.data.description, category, toCents(parsed.data.amount), "manual", now);

  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as ExpenseRow;
  emitEvent("expense_created", { expense: mapExpenseRow(row) });
  const afterBudget = getBudgetState(month);
  if (beforeBudget && afterBudget && beforeBudget.exceeded !== afterBudget.exceeded) {
    emitEvent("budget_exceeded", { month, exceeded: afterBudget.exceeded });
  }
  res.status(201).json({ item: mapExpenseRow(row) });
});

expensesRouter.put("/expenses/:id", (req, res) => {
  const parsed = expenseUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() });
    return;
  }

  const current = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id) as ExpenseRow | undefined;
  if (!current) {
    res.status(404).json({ error: "Gasto não encontrado." });
    return;
  }

  const currentMonth = monthOf(current.date) ?? current.date.slice(0, 7);
  const beforeBudgetCurrent = getBudgetState(currentMonth);

  const next = {
    date: parsed.data.date ?? current.date,
    description: parsed.data.description ?? current.description,
    category: parsed.data.category ?? current.category,
    amount_cents: parsed.data.amount !== undefined ? toCents(parsed.data.amount) : current.amount_cents
  };

  const nextMonth = monthOf(next.date) ?? next.date.slice(0, 7);
  const beforeBudgetNext = nextMonth === currentMonth ? beforeBudgetCurrent : getBudgetState(nextMonth);

  db.prepare("UPDATE expenses SET date = ?, description = ?, category = ?, amount_cents = ? WHERE id = ?").run(
    next.date,
    next.description,
    next.category,
    next.amount_cents,
    req.params.id
  );

  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id) as ExpenseRow;
  emitEvent("expense_updated", { expense: mapExpenseRow(row) });

  const afterBudgetCurrent = getBudgetState(currentMonth);
  if (beforeBudgetCurrent && afterBudgetCurrent && beforeBudgetCurrent.exceeded !== afterBudgetCurrent.exceeded) {
    emitEvent("budget_exceeded", { month: currentMonth, exceeded: afterBudgetCurrent.exceeded });
  }
  if (nextMonth !== currentMonth) {
    const afterBudgetNext = getBudgetState(nextMonth);
    if (beforeBudgetNext && afterBudgetNext && beforeBudgetNext.exceeded !== afterBudgetNext.exceeded) {
      emitEvent("budget_exceeded", { month: nextMonth, exceeded: afterBudgetNext.exceeded });
    }
  }
  res.json({ item: mapExpenseRow(row) });
});

expensesRouter.delete("/expenses/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id) as ExpenseRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Gasto não encontrado." });
    return;
  }
  const month = monthOf(row.date) ?? row.date.slice(0, 7);
  const beforeBudget = getBudgetState(month);
  db.prepare("DELETE FROM expenses WHERE id = ?").run(req.params.id);
  emitEvent("expense_deleted", { id: req.params.id });
  const afterBudget = getBudgetState(month);
  if (beforeBudget && afterBudget && beforeBudget.exceeded !== afterBudget.exceeded) {
    emitEvent("budget_exceeded", { month, exceeded: afterBudget.exceeded });
  }
  res.json({ ok: true });
});

expensesRouter.get("/stats", (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  if (!month) {
    res.status(400).json({ error: "Informe month=YYYY-MM." });
    return;
  }
  const summary = getMonthSummary(month);
  if (!summary) {
    res.status(400).json({ error: "Mês inválido." });
    return;
  }
  res.json(summary);
});

expensesRouter.get("/history", (req, res) => {
  const until = typeof req.query.until === "string" ? req.query.until : undefined;
  const months = typeof req.query.months === "string" ? Number(req.query.months) : 12;
  if (!until) {
    res.status(400).json({ error: "Informe until=YYYY-MM." });
    return;
  }
  const clamped = Number.isFinite(months) ? Math.max(1, Math.min(24, months)) : 12;
  res.json({ items: getLastMonthsTotals(clamped, until) });
});
