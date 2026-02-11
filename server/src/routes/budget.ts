import { Router } from "express";
import { z } from "zod";
import { getBudgetState } from "../budget.js";
import { db } from "../db.js";
import { emitEvent } from "../events.js";
import { toCents } from "../money.js";

export const budgetRouter = Router();

budgetRouter.get("/budget", (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  if (!month) {
    res.status(400).json({ error: "Informe month=YYYY-MM." });
    return;
  }

  const row = db.prepare("SELECT amount_cents AS amountCents FROM budgets WHERE month = ?").get(month) as
    | { amountCents: number }
    | undefined;
  res.json({ month, amount: row ? row.amountCents / 100 : null });
});

const budgetUpsertSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().positive()
});

budgetRouter.post("/budget", (req, res) => {
  const parsed = budgetUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos.", details: parsed.error.flatten() });
    return;
  }

  const before = getBudgetState(parsed.data.month);
  db.prepare("INSERT INTO budgets(month, amount_cents) VALUES(?, ?) ON CONFLICT(month) DO UPDATE SET amount_cents = excluded.amount_cents").run(
    parsed.data.month,
    toCents(parsed.data.amount)
  );
  emitEvent("budget_updated", { month: parsed.data.month, amount: parsed.data.amount });

  const after = getBudgetState(parsed.data.month);
  if (before && after && before.exceeded !== after.exceeded) {
    emitEvent("budget_exceeded", { month: parsed.data.month, exceeded: after.exceeded });
  }

  res.json({ ok: true });
});

