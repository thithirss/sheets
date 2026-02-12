import { categories, categorizeExpense } from "./categories.js";
import { todayISO } from "./dates.js";
import { parseAmount } from "./money.js";

export type ParsedExpenseInput = { amount: number; description: string; dateISO: string; category: string };

export function stripAccents(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeCategoryToken(input: string): string {
  return stripAccents(input).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveCategory(input: string | null, description: string): string {
  if (!input) return categorizeExpense(description);
  const key = normalizeCategoryToken(input.replace(/^#/, ""));
  const map: Record<string, string> = {
    alimentacao: "Alimentação",
    alimentacaoe: "Alimentação",
    transporte: "Transporte",
    moradia: "Moradia",
    saude: "Saúde",
    educacao: "Educação",
    lazer: "Lazer",
    compras: "Compras",
    contas: "Contas",
    outros: "Outros"
  };

  const mapped = map[key];
  if (mapped) return mapped;

  const byName = categories.find((c) => normalizeCategoryToken(c) === key);
  return byName ?? categorizeExpense(description);
}

export function parseDateToken(token: string, now = new Date()): string | null {
  const trimmed = token.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const m1 = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  const m2 = /^(\d{2})\/(\d{2})$/.exec(trimmed);
  if (m2) {
    const y = now.getFullYear();
    return `${y}-${m2[2]}-${m2[1]}`;
  }
  return null;
}

function extractTagToken(tokens: string[]): { tag: string | null; rest: string[] } {
  const idx = tokens.findIndex((t) => t.startsWith("#") && t.length > 1);
  if (idx === -1) return { tag: null, rest: tokens };
  const tag = tokens[idx];
  const rest = tokens.slice(0, idx).concat(tokens.slice(idx + 1));
  return { tag, rest };
}

export function parseExpenseInput(text: string): ParsedExpenseInput | null {
  const raw = text.trim();
  if (!raw) return null;

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  const isGasto = /^GASTO$/i.test(tokens[0]);
  const work = isGasto ? tokens.slice(1) : tokens.slice(0);
  if (!work.length) return null;

  const { tag, rest: withoutTag } = extractTagToken(work);
  let dateISO: string | null = null;
  const last = withoutTag[withoutTag.length - 1] ?? "";
  const parsedLastDate = parseDateToken(last);
  const core = parsedLastDate ? withoutTag.slice(0, -1) : withoutTag;
  if (parsedLastDate) dateISO = parsedLastDate;
  if (!core.length) return null;

  const amount = parseAmount(core[0]);
  if (amount === null) return null;
  const description = core.slice(1).join(" ").trim();
  if (!description) return null;

  const finalDate = dateISO ?? todayISO();
  const category = resolveCategory(tag, description);
  return { amount, description, dateISO: finalDate, category };
}

export function parseMenuChoice(input: string): number | null {
  const raw = input.trim();
  if (!raw) return null;
  const lowered = stripAccents(raw).toLowerCase().replace(/^["“”']+|["“”']+$/g, "").trim();
  const wordMap: Record<string, number> = {
    zero: 0,
    um: 1,
    uma: 1,
    dois: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9
  };
  const asWord = wordMap[lowered];
  if (typeof asWord === "number") return asWord;
  if (/[a-z]/.test(lowered)) return null;
  const digits = lowered.replace(/\D/g, "");
  if (digits.length !== 1) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n >= 0 && n <= 9 ? n : null;
}

