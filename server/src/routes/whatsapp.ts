import crypto from "node:crypto";
import { Router } from "express";
import { categorizeExpense } from "../categories.js";
import { getBudgetState } from "../budget.js";
import { monthOf, todayISO } from "../dates.js";
import { getSetting } from "../db.js";
import { emitEvent } from "../events.js";
import { mapExpenseRow } from "../mappers.js";
import { parseAmount, toCents } from "../money.js";
import type { ExpenseRow } from "../types.js";
import { env } from "../env.js";
import { db } from "../db.js";
import { sendWhatsAppText } from "../whatsapp.js";

export const whatsappRouter = Router();

whatsappRouter.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === env.whatsapp.verifyToken) {
    res.status(200).send(String(challenge ?? ""));
    return;
  }

  res.sendStatus(403);
});

function extractTextMessage(body: unknown): { from: string; text: string } | null {
  const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
  const asArr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);

  const root = asObj(body);
  const entry0 = asObj(asArr(root?.entry)?.[0]);
  const change0 = asObj(asArr(entry0?.changes)?.[0]);
  const value = asObj(change0?.value);
  const message0 = asObj(asArr(value?.messages)?.[0]);
  const from = message0?.from;
  const text = asObj(message0?.text)?.body;
  if (typeof from !== "string" || typeof text !== "string") return null;
  return { from, text };
}

function parseGastoMessage(text: string): { amount: number; description: string } | null {
  const match = /^\s*GASTO\s+([0-9]+(?:[.,][0-9]{1,2})?)\s+(.+?)\s*$/i.exec(text);
  if (!match) return null;
  const amount = parseAmount(match[1]);
  if (amount === null) return null;
  const description = match[2].trim();
  if (!description) return null;
  return { amount, description };
}

whatsappRouter.post("/webhook", async (req, res) => {
  const extracted = extractTextMessage(req.body);
  if (!extracted) {
    res.sendStatus(200);
    return;
  }

  const allowedPhone = getSetting("phone");
  if (allowedPhone && extracted.from !== allowedPhone) {
    res.sendStatus(200);
    return;
  }

  const parsed = parseGastoMessage(extracted.text);
  if (!parsed) {
    try {
      await sendWhatsAppText(extracted.from, 'Formato inválido. Use: "GASTO 45.90 Almoço restaurante"');
    } catch (_err) {
      void _err;
    }
    res.sendStatus(200);
    return;
  }

  const date = todayISO();
  const month = monthOf(date) ?? date.slice(0, 7);
  const beforeBudget = getBudgetState(month);
  const category = categorizeExpense(parsed.description);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(
    "INSERT INTO expenses(id, date, description, category, amount_cents, source, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)"
  ).run(id, date, parsed.description, category, toCents(parsed.amount), "whatsapp", now);

  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as ExpenseRow;
  emitEvent("expense_created", { expense: mapExpenseRow(row) });

  const afterBudget = getBudgetState(month);
  if (beforeBudget && afterBudget && beforeBudget.exceeded !== afterBudget.exceeded) {
    emitEvent("budget_exceeded", { month, exceeded: afterBudget.exceeded });
  }

  try {
    await sendWhatsAppText(extracted.from, `Registrado: R$ ${parsed.amount.toFixed(2)} - ${parsed.description} (${category})`);
  } catch (_err) {
    void _err;
  }

  res.sendStatus(200);
});
