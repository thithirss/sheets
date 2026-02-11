import crypto from "node:crypto";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import { categories, categorizeExpense } from "./categories.js";
import { getBudgetState } from "./budget.js";
import { monthOf, monthStartEnd, todayISO } from "./dates.js";
import { emitEvent } from "./events.js";
import { mapExpenseRow } from "./mappers.js";
import { fromCents, parseAmount, toCents } from "./money.js";
import { getLastMonthsTotals, getMonthSummary } from "./stats.js";
import type { ExpenseRow } from "./types.js";
import { db, getSetting, setSetting } from "./db.js";

type WaWebStatus = {
  enabled: boolean;
  state: "starting" | "qr" | "ready" | "auth_failure" | "disconnected";
  allowedFromDigits: string[];
  configuredChatId: string | null;
  configuredChatName: string | null;
  selectedChatId: string | null;
  lastMessageAt: string | null;
  lastAcceptedAt: string | null;
  lastRejectReason: string | null;
};

export const waWebStatus: WaWebStatus = {
  enabled: false,
  state: "starting",
  allowedFromDigits: [],
  configuredChatId: null,
  configuredChatName: null,
  selectedChatId: null,
  lastMessageAt: null,
  lastAcceptedAt: null,
  lastRejectReason: null
};

type ParsedExpenseInput = { amount: number; description: string; dateISO: string; category: string };

function stripAccents(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeCategoryToken(input: string): string {
  return stripAccents(input).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resolveCategory(input: string | null, description: string): string {
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

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function parseMonth(input: string | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function monthDays(month: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return new Date(y, m, 0).getDate();
}

function bar(value: number, max: number, width = 12): string {
  if (max <= 0) return " ".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return "█".repeat(filled).padEnd(width, " ");
}

function card(title: string, lines: string[]): string {
  const body = lines.filter(Boolean).join("\n");
  return [title, "—".repeat(28), body].filter(Boolean).join("\n");
}

function formatCategoryChart(items: Array<{ label: string; value: number }>): string {
  if (!items.length) return "Sem dados.";
  const max = Math.max(...items.map((i) => i.value));
  const top = items.slice(0, 6);
  return top
    .map((i) => {
      const name = i.label.length > 14 ? `${i.label.slice(0, 13)}…` : i.label;
      return `${name.padEnd(14, " ")} ${bar(i.value, max)} ${formatBRL(i.value)}`;
    })
    .join("\n");
}

function formatMonthHistory(items: Array<{ month: string; total: number }>): string {
  if (!items.length) return "Sem dados.";
  const max = Math.max(...items.map((i) => i.total));
  return items
    .map((i) => `${i.month} ${bar(i.total, max)} ${formatBRL(i.total)}`)
    .join("\n");
}

function formatDayChart(items: Array<{ date: string; total: number }>): string {
  if (!items.length) return "Sem dados.";
  const last = items.slice(Math.max(0, items.length - 7));
  const max = Math.max(...last.map((i) => i.total));
  return last
    .map((i) => `${i.date.slice(8)} ${bar(i.total, max)} ${formatBRL(i.total)}`)
    .join("\n");
}

function helpText(): string {
  return [
    "Comandos:",
    '• GASTO 45.90 Almoço restaurante',
    '• 45.90 Almoço restaurante',
    '• GASTO 45.90 Almoço #alimentacao 08/02',
    '• RESUMO [AAAA-MM]',
    '• TOTAL [AAAA-MM]',
    '• MAIOR [AAAA-MM]',
    '• ORCAMENTO [AAAA-MM] 2500',
    '• ORCAMENTO SEMANAL 500',
    '• ORCAMENTO Alimentação 800',
    '• ORCAMENTO 2026-02 Alimentação 800',
    '• ORCAMENTO [AAAA-MM] (ver)',
    '• GRAFICO [AAAA-MM]',
    '• LISTA [N] [AAAA-MM]',
    '• BUSCA termo [AAAA-MM]',
    '• DIA 2026-02-08 | DIA 08/02',
    '• CATEGORIAS [AAAA-MM]',
    '• DESFAZER',
    '• REMOVER <id>',
    '• EDITAR <id> 39.90',
    '• HOJE',
    '• AJUDA'
  ].join("\n");
}

function monthDefault(): string {
  return todayISO().slice(0, 7);
}

function parseDateToken(token: string, now = new Date()): string | null {
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

function parseExpenseInput(text: string): ParsedExpenseInput | null {
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

function idShort(id: string): string {
  return id.slice(0, 8);
}

function findExpenseByPrefix(prefix: string): ExpenseRow[] {
  const clean = prefix.trim();
  if (!/^[a-f0-9]{4,}$/i.test(clean)) return [];
  return db
    .prepare("SELECT * FROM expenses WHERE lower(id) LIKE lower(?) ORDER BY created_at DESC LIMIT 5")
    .all(`${clean}%`) as ExpenseRow[];
}

function currentWeekRange(today = new Date()): { from: string; to: string } {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  const from = d.toISOString().slice(0, 10);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  end.setDate(end.getDate() + 6);
  const to = end.toISOString().slice(0, 10);
  return { from, to };
}

function getWeeklyBudget(): number | null {
  const raw = getSetting("weekly_budget_cents");
  if (!raw) return null;
  const cents = Number(raw);
  return Number.isFinite(cents) && cents > 0 ? fromCents(cents) : null;
}

function setWeeklyBudget(amount: number): void {
  setSetting("weekly_budget_cents", String(toCents(amount)));
}

function getCategoryBudget(month: string, category: string): number | null {
  const row = db
    .prepare("SELECT amount_cents AS amountCents FROM category_budgets WHERE month = ? AND category = ?")
    .get(month, category) as { amountCents: number } | undefined;
  return row ? fromCents(row.amountCents) : null;
}

function setCategoryBudget(month: string, category: string, amount: number): void {
  db.prepare(
    "INSERT INTO category_budgets(month, category, amount_cents) VALUES(?, ?, ?) ON CONFLICT(month, category) DO UPDATE SET amount_cents = excluded.amount_cents"
  ).run(month, category, toCents(amount));
}

function monthTotalByCategory(month: string, category: string): number {
  const range = monthStartEnd(month);
  if (!range) return 0;
  const row = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE date >= ? AND date <= ? AND category = ?")
    .get(range.from, range.to, category) as { totalCents: number };
  return fromCents(row.totalCents ?? 0);
}

function handleCommand(body: string): string | null {
  const text = body.trim();
  if (!text) return null;

  const upper = text.toUpperCase();
  if (upper === "AJUDA" || upper === "HELP" || upper === "MENU") return helpText();

  const listaMatch = /^LISTA(?:\s+(\d+))?(?:\s+(\d{4}-\d{2}))?\s*$/i.exec(text);
  if (listaMatch) {
    const n = listaMatch[1] ? Math.max(1, Math.min(30, Number(listaMatch[1]))) : 10;
    const month = parseMonth(listaMatch[2]) ?? monthDefault();
    const range = monthStartEnd(month);
    if (!range) return "Mês inválido. Use AAAA-MM.";

    const rows = db
      .prepare("SELECT * FROM expenses WHERE date >= ? AND date <= ? ORDER BY date DESC, created_at DESC LIMIT ?")
      .all(range.from, range.to, n) as ExpenseRow[];

    if (!rows.length) return `Sem gastos em ${month}.`;

    const lines = rows.map((r) => {
      const desc = r.description.length > 28 ? `${r.description.slice(0, 27)}…` : r.description;
      return `${idShort(r.id)} ${r.date} ${formatBRL(fromCents(r.amount_cents))} ${r.category} • ${desc}`;
    });
    return card(`Lista (${month})`, lines);
  }

  const buscaMatch = /^BUSCA\s+(.+?)\s*$/i.exec(text);
  if (buscaMatch) {
    const rawTerm = buscaMatch[1].trim();
    if (!rawTerm) return "Use: BUSCA termo [AAAA-MM]";
    const parts = rawTerm.split(/\s+/);
    const last = parts[parts.length - 1] ?? "";
    const maybeMonth = parseMonth(last);
    const term = maybeMonth ? parts.slice(0, -1).join(" ") : rawTerm;
    const month = maybeMonth ?? monthDefault();
    const range = monthStartEnd(month);
    if (!range) return "Mês inválido. Use AAAA-MM.";

    const rows = db
      .prepare(
        "SELECT * FROM expenses WHERE date >= ? AND date <= ? AND lower(description) LIKE lower(?) ORDER BY date DESC, created_at DESC LIMIT 10"
      )
      .all(range.from, range.to, `%${term}%`) as ExpenseRow[];
    if (!rows.length) return `Nada encontrado em ${month} para: ${term}`;
    const lines = rows.map((r) => `${idShort(r.id)} ${r.date} ${formatBRL(fromCents(r.amount_cents))} ${r.category} • ${r.description}`);
    return card(`Busca (${month})`, lines);
  }

  const diaMatch = /^DIA\s+(.+?)\s*$/i.exec(text);
  if (diaMatch) {
    const date = parseDateToken(diaMatch[1]) ?? null;
    if (!date) return "Data inválida. Use DIA 2026-02-08 ou DIA 08/02.";
    const rows = db
      .prepare("SELECT * FROM expenses WHERE date = ? ORDER BY created_at DESC")
      .all(date) as ExpenseRow[];
    const totalRow = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE date = ?").get(date) as {
      totalCents: number;
    };
    const total = fromCents(totalRow.totalCents ?? 0);
    const lines = rows.length
      ? rows.slice(0, 20).map((r) => `${idShort(r.id)} ${formatBRL(fromCents(r.amount_cents))} ${r.category} • ${r.description}`)
      : ["Sem gastos."];
    return card(`Dia ${date} • Total ${formatBRL(total)}`, lines);
  }

  const categoriasMatch = /^CATEGORIAS(?:\s+(\d{4}-\d{2}))?\s*$/i.exec(text);
  if (categoriasMatch) {
    const month = parseMonth(categoriasMatch[1]) ?? monthDefault();
    const summary = getMonthSummary(month);
    if (!summary) return "Mês inválido. Use AAAA-MM.";
    const chart = formatCategoryChart(summary.byCategory.map((c) => ({ label: c.category, value: c.total })));
    return card(`Categorias ${month} • Total ${formatBRL(summary.total)}`, chart.split("\n"));
  }

  const resumoMatch = /^RESUMO(?:\s+(\d{4}-\d{2}))?\s*$/i.exec(text);
  if (resumoMatch) {
    const month = parseMonth(resumoMatch[1]) ?? monthDefault();
    const summary = getMonthSummary(month);
    if (!summary) return "Mês inválido. Use AAAA-MM.";

    const days = monthDays(month);
    const today = todayISO();
    const isCurrent = today.startsWith(month);
    const dayOfMonth = new Date().getDate();
    const remainingDays = isCurrent && days ? Math.max(0, days - dayOfMonth) : 0;
    const remainingBudget =
      summary.budget !== null ? Math.max(0, summary.budget - summary.total) : null;
    const targetDaily =
      remainingBudget !== null && remainingDays > 0 ? remainingBudget / remainingDays : null;

    const lines: string[] = [];
    lines.push(`Total: ${formatBRL(summary.total)}`);
    lines.push(`Média/dia: ${formatBRL(summary.averageDaily)}`);
    lines.push(`Projeção: ${formatBRL(summary.projectionEndOfMonth)}`);
    if (summary.maxExpense) {
      lines.push(`Maior: ${formatBRL(summary.maxExpense.amount)} • ${summary.maxExpense.description} • ${summary.maxExpense.date}`);
    } else {
      lines.push("Maior: -");
    }
    if (summary.budget !== null) {
      lines.push(`Orçamento: ${formatBRL(summary.budget)} (${summary.budgetExceeded ? "ESTOUROU" : "ok"})`);
      if (targetDaily !== null) lines.push(`Meta diária (restante): ${formatBRL(targetDaily)}`);
    } else {
      lines.push("Orçamento: - (use ORCAMENTO 2500)");
    }
    const title = `Resumo ${month}`;
    return card(title, lines);
  }

  const totalMatch = /^TOTAL(?:\s+(\d{4}-\d{2}))?\s*$/i.exec(text);
  if (totalMatch) {
    const month = parseMonth(totalMatch[1]) ?? monthDefault();
    const summary = getMonthSummary(month);
    if (!summary) return "Mês inválido. Use AAAA-MM.";
    return `Total ${month}: ${formatBRL(summary.total)}`;
  }

  const maiorMatch = /^MAIOR(?:\s+(\d{4}-\d{2}))?\s*$/i.exec(text);
  if (maiorMatch) {
    const month = parseMonth(maiorMatch[1]) ?? monthDefault();
    const summary = getMonthSummary(month);
    if (!summary) return "Mês inválido. Use AAAA-MM.";
    if (!summary.maxExpense) return `Sem gastos em ${month}.`;
    return `Maior ${month}: ${formatBRL(summary.maxExpense.amount)}\n${summary.maxExpense.description}\n${summary.maxExpense.date} • ${summary.maxExpense.category}`;
  }

  const hojeMatch = /^HOJE\s*$/i.exec(text);
  if (hojeMatch) {
    const today = todayISO();
    const row = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE date = ?").get(today) as {
      totalCents: number;
    };
    const total = fromCents(row.totalCents ?? 0);
    return card(`Hoje (${today})`, [`Total: ${formatBRL(total)}`, "Use: DIA 08/02 para detalhes."]);
  }

  if (/^ORCAMENTO\b/i.test(text)) {
    const parts = text.trim().split(/\s+/);
    const p1 = parts[1] ?? "";
    const p1Upper = p1.toUpperCase();

    if (p1Upper === "SEMANAL") {
      const amount = parts[2] ? parseAmount(parts[2]) : null;
      if (parts[2] && amount === null) return "Valor inválido. Ex: ORCAMENTO SEMANAL 500";
      if (amount !== null) setWeeklyBudget(amount);
      const weekly = getWeeklyBudget();
      const range = currentWeekRange();
      const totalRow = db
        .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE date >= ? AND date <= ?")
        .get(range.from, range.to) as { totalCents: number };
      const spent = fromCents(totalRow.totalCents ?? 0);
      const remaining = weekly !== null ? Math.max(0, weekly - spent) : null;
      const lines = [`Semana: ${range.from} a ${range.to}`, `Gasto: ${formatBRL(spent)}`];
      if (weekly !== null) lines.push(`Orçamento semanal: ${formatBRL(weekly)}`, `Restante: ${formatBRL(remaining ?? 0)}`);
      if (weekly === null) lines.push("Orçamento semanal: -");
      return card("Orçamento semanal", lines);
    }

    const p1Month = parseMonth(p1);
    if (!p1) {
      const month = monthDefault();
      const summary = getMonthSummary(month);
      const weekly = getWeeklyBudget();
      const lines: string[] = [];
      if (summary) {
        lines.push(`Mês ${month}: ${summary.budget !== null ? formatBRL(summary.budget) : "-"} • Gasto ${formatBRL(summary.total)}`);
      }
      if (weekly !== null) lines.push(`Semanal: ${formatBRL(weekly)}`);
      return card("Orçamentos", lines.length ? lines : ["Sem dados."]);
    }

    if (p1Month) {
      const month = p1Month;
      if (parts.length === 2) {
        const summary = getMonthSummary(month);
        if (!summary) return "Mês inválido. Use AAAA-MM.";
        const budgetText = summary.budget !== null ? formatBRL(summary.budget) : "-";
        const status = summary.budget !== null ? (summary.budgetExceeded ? "ESTOUROU" : "ok") : "sem";
        return card(`Orçamento ${month}`, [`Orçamento: ${budgetText} (${status})`, `Gasto: ${formatBRL(summary.total)}`]);
      }

      const lastAmount = parts[parts.length - 1] ?? "";
      const amount = parseAmount(lastAmount);
      if (amount !== null && parts.length === 3) {
        const before = getBudgetState(month);
        db.prepare("INSERT INTO budgets(month, amount_cents) VALUES(?, ?) ON CONFLICT(month) DO UPDATE SET amount_cents = excluded.amount_cents").run(
          month,
          toCents(amount)
        );
        emitEvent("budget_updated", { month, amount });
        const after = getBudgetState(month);
        if (before && after && before.exceeded !== after.exceeded) {
          emitEvent("budget_exceeded", { month, exceeded: after.exceeded });
        }
        const summary = getMonthSummary(month);
        if (!summary) return "Mês inválido. Use AAAA-MM.";
        return card(`Orçamento ${month}`, [`Orçamento: ${formatBRL(amount)}`, `Gasto: ${formatBRL(summary.total)}`]);
      }

      if (amount === null) return "Use: ORCAMENTO 2026-02 2500 ou ORCAMENTO 2026-02 Alimentação 800";
      const categoryRaw = parts.slice(2, -1).join(" ").trim();
      const category = resolveCategory(categoryRaw, categoryRaw);
      setCategoryBudget(month, category, amount);
      const spent = monthTotalByCategory(month, category);
      const remaining = Math.max(0, amount - spent);
      return card(`Orçamento ${month} • ${category}`, [`Orçamento: ${formatBRL(amount)}`, `Gasto: ${formatBRL(spent)}`, `Restante: ${formatBRL(remaining)}`]);
    }

    const maybeAmount = parseAmount(p1);
    if (maybeAmount !== null && parts.length === 2) {
      const month = monthDefault();
      const before = getBudgetState(month);
      db.prepare("INSERT INTO budgets(month, amount_cents) VALUES(?, ?) ON CONFLICT(month) DO UPDATE SET amount_cents = excluded.amount_cents").run(
        month,
        toCents(maybeAmount)
      );
      emitEvent("budget_updated", { month, amount: maybeAmount });
      const after = getBudgetState(month);
      if (before && after && before.exceeded !== after.exceeded) {
        emitEvent("budget_exceeded", { month, exceeded: after.exceeded });
      }
      const summary = getMonthSummary(month);
      if (!summary) return "Mês inválido. Use AAAA-MM.";
      return card(`Orçamento ${month}`, [`Orçamento: ${formatBRL(maybeAmount)}`, `Gasto: ${formatBRL(summary.total)}`]);
    }

    const lastAmount = parts[parts.length - 1] ?? "";
    const amount = parseAmount(lastAmount);
    const month = monthDefault();
    if (amount === null) {
      const categoryRaw = parts.slice(1).join(" ").trim();
      const category = resolveCategory(categoryRaw, categoryRaw);
      const budget = getCategoryBudget(month, category);
      const spent = monthTotalByCategory(month, category);
      const remaining = budget !== null ? Math.max(0, budget - spent) : null;
      const lines = [`Mês: ${month}`, `Categoria: ${category}`, `Gasto: ${formatBRL(spent)}`];
      lines.push(`Orçamento: ${budget !== null ? formatBRL(budget) : "-"}`);
      if (remaining !== null) lines.push(`Restante: ${formatBRL(remaining)}`);
      return card("Orçamento por categoria", lines);
    }

    const categoryRaw = parts.slice(1, -1).join(" ").trim();
    const category = resolveCategory(categoryRaw, categoryRaw);
    setCategoryBudget(month, category, amount);
    const spent = monthTotalByCategory(month, category);
    const remaining = Math.max(0, amount - spent);
    return card(`Orçamento ${month} • ${category}`, [`Orçamento: ${formatBRL(amount)}`, `Gasto: ${formatBRL(spent)}`, `Restante: ${formatBRL(remaining)}`]);
  }

  const grafMatch = /^GRAFICO(?:\s+(\d{4}-\d{2}))?\s*$/i.exec(text);
  if (grafMatch) {
    const month = parseMonth(grafMatch[1]) ?? monthDefault();
    const summary = getMonthSummary(month);
    if (!summary) return "Mês inválido. Use AAAA-MM.";

    const byCat = formatCategoryChart(summary.byCategory.map((c) => ({ label: c.category, value: c.total })));
    const byDay = formatDayChart(summary.byDay);
    const hist = formatMonthHistory(getLastMonthsTotals(12, month));

    return [`Gráficos ${month}`, "", "Por categoria:", byCat, "", "Últimos dias:", byDay, "", "12 meses:", hist].join("\n");
  }

  const desfazerMatch = /^DESFAZER\s*$/i.exec(text);
  if (desfazerMatch) {
    const lastId = getSetting("wa_last_expense_id");
    if (!lastId) return "Nada para desfazer.";
    const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(lastId) as ExpenseRow | undefined;
    if (!row) return "Nada para desfazer.";
    if (row.source !== "whatsapp") return "Último lançamento não é do WhatsApp.";
    db.prepare("DELETE FROM expenses WHERE id = ?").run(lastId);
    emitEvent("expense_deleted", { id: lastId });
    setSetting("wa_last_expense_id", "");
    return card("Desfeito", [`Removido: ${idShort(row.id)} ${row.date} ${formatBRL(fromCents(row.amount_cents))} • ${row.description}`]);
  }

  const removerMatch = /^REMOVER\s+([a-f0-9]{4,})\s*$/i.exec(text);
  if (removerMatch) {
    const prefix = removerMatch[1];
    const matches = findExpenseByPrefix(prefix);
    if (!matches.length) return "Não encontrei esse id.";
    if (matches.length > 1 && matches[0].id.slice(0, prefix.length).toLowerCase() !== matches[1].id.slice(0, prefix.length).toLowerCase()) {
      return "Não encontrei esse id.";
    }
    const samePrefix = matches.filter((r) => r.id.toLowerCase().startsWith(prefix.toLowerCase()));
    if (samePrefix.length !== 1) return "Id curto ambíguo. Use mais caracteres.";
    const row = samePrefix[0]!;
    db.prepare("DELETE FROM expenses WHERE id = ?").run(row.id);
    emitEvent("expense_deleted", { id: row.id });
    return card("Removido", [`${idShort(row.id)} ${row.date} ${formatBRL(fromCents(row.amount_cents))} • ${row.description}`]);
  }

  const editarMatch = /^EDITAR\s+([a-f0-9]{4,})(?:\s+(.+))?$/i.exec(text);
  if (editarMatch) {
    const prefix = editarMatch[1];
    const rest = (editarMatch[2] ?? "").trim();
    if (!rest) return "Use: EDITAR <id> 39.90 ou EDITAR <id> nova descrição";
    const matches = findExpenseByPrefix(prefix);
    const samePrefix = matches.filter((r) => r.id.toLowerCase().startsWith(prefix.toLowerCase()));
    if (samePrefix.length !== 1) return "Id curto ambíguo. Use mais caracteres.";
    const current = samePrefix[0]!;

    const restParts = rest.split(/\s+/);
    const mode = restParts[0]!.toUpperCase();

    let nextDate = current.date;
    let nextDescription = current.description;
    let nextCategory = current.category;
    let nextAmountCents = current.amount_cents;

    if (mode === "DATA" && restParts[1]) {
      const d = parseDateToken(restParts[1]);
      if (!d) return "Data inválida. Use 2026-02-08 ou 08/02.";
      nextDate = d;
    } else if (mode === "CAT" && restParts[1]) {
      nextCategory = resolveCategory(restParts.slice(1).join(" "), current.description);
    } else {
      const maybeAmount = parseAmount(restParts[0]!);
      if (maybeAmount !== null) {
        nextAmountCents = toCents(maybeAmount);
      } else {
        nextDescription = rest;
        nextCategory = categorizeExpense(nextDescription);
      }
    }

    db.prepare("UPDATE expenses SET date = ?, description = ?, category = ?, amount_cents = ? WHERE id = ?").run(
      nextDate,
      nextDescription,
      nextCategory,
      nextAmountCents,
      current.id
    );
    const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(current.id) as ExpenseRow;
    emitEvent("expense_updated", { expense: mapExpenseRow(row) });
    return card("Editado", [`${idShort(row.id)} ${row.date} ${formatBRL(fromCents(row.amount_cents))} ${row.category}`, row.description]);
  }

  return null;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeWaIdToDigits(id: string): string {
  return onlyDigits(id.split("@")[0] ?? id);
}

function brVariantNumbers(digits: string): string[] {
  if (!digits.startsWith("55")) return [digits];
  if (digits.length === 13 && digits[4] === "9") {
    return [digits, digits.slice(0, 4) + digits.slice(5)];
  }
  if (digits.length === 12) {
    return [digits, digits.slice(0, 4) + "9" + digits.slice(4)];
  }
  return [digits];
}

export function startWhatsAppWebIngest(params: { chatId?: string; chatName?: string; allowedFrom?: string }): void {
  const { Client, LocalAuth } = pkg as unknown as {
    Client: typeof import("whatsapp-web.js").Client;
    LocalAuth: typeof import("whatsapp-web.js").LocalAuth;
  };

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: "gastos" })
  });

  let selectedChatId: string | null = params.chatId ?? null;
  let scheduleInterval: ReturnType<typeof setInterval> | null = null;
  const allowedFromDigits = (params.allowedFrom ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => brVariantNumbers(onlyDigits(s)));
  const allowedFromSet = new Set(allowedFromDigits);

  waWebStatus.enabled = true;
  waWebStatus.state = "starting";
  waWebStatus.allowedFromDigits = allowedFromDigits;
  waWebStatus.configuredChatId = params.chatId ?? null;
  waWebStatus.configuredChatName = params.chatName ?? null;
  waWebStatus.selectedChatId = selectedChatId;

  console.log(
    `[wa] enabled=1 allowedFrom=${allowedFromDigits.length ? allowedFromDigits.join(",") : "-"} chatId=${params.chatId ?? "-"} chatName=${params.chatName ?? "-"}`
  );

  client.on("qr", (qr) => {
    waWebStatus.state = "qr";
    console.log("[wa] QR gerado. Escaneie no WhatsApp do número \"pai\" (Aparelhos conectados).");
    qrcode.generate(qr, { small: true });
  });

  client.on("authenticated", () => {
    console.log("[wa] Autenticado.");
  });

  client.on("auth_failure", (message) => {
    waWebStatus.state = "auth_failure";
    waWebStatus.lastRejectReason = `auth_failure: ${String(message)}`;
    console.log(`[wa] Falha de autenticação: ${String(message)}`);
  });

  client.on("disconnected", (reason) => {
    waWebStatus.state = "disconnected";
    waWebStatus.lastRejectReason = `disconnected: ${String(reason)}`;
    console.log(`[wa] Desconectado: ${String(reason)}`);
    if (scheduleInterval) {
      clearInterval(scheduleInterval);
      scheduleInterval = null;
    }
  });

  client.on("ready", async () => {
    waWebStatus.state = "ready";
    console.log("[wa] Ready.");
    if (selectedChatId) return;
    if (!params.chatName) return;
    const chats = await client.getChats();
    const found = chats.find((c) => c.name?.toLowerCase() === params.chatName!.toLowerCase());
    selectedChatId = found?.id?._serialized ?? null;
    waWebStatus.selectedChatId = selectedChatId;
    console.log(`[wa] Chat selecionado: ${selectedChatId ?? "(não encontrado)"} (${params.chatName})`);
  });

  const savedNotifyChatId = getSetting("wa_notify_chat_id");
  let notifyChatId: string | null = savedNotifyChatId?.trim() ? savedNotifyChatId.trim() : null;

  const scheduleTick = async () => {
    if (!notifyChatId) return;
    if (waWebStatus.state !== "ready") return;

    const now = new Date();
    const hh = now.getHours();
    const mm = now.getMinutes();
    const today = todayISO();

    const sendIf = async (key: string, title: string, text: string) => {
      const last = getSetting(key);
      if (last === today) return;
      try {
        await client.sendMessage(notifyChatId!, text);
        setSetting(key, today);
        console.log(`[wa] scheduled_sent ${title}`);
      } catch (e) {
        console.log(`[wa] scheduled_error ${title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    if (hh === 9 && mm >= 0 && mm <= 1) {
      const month = monthDefault();
      const summary = getMonthSummary(month);
      if (summary && summary.budget !== null) {
        const days = monthDays(month);
        const dayOfMonth = now.getDate();
        const remainingDays = days ? Math.max(0, days - dayOfMonth) : 0;
        const remainingBudget = Math.max(0, summary.budget - summary.total);
        const targetDaily = remainingDays > 0 ? remainingBudget / remainingDays : remainingBudget;
        await sendIf(
          "wa_last_daily_target_date",
          "daily_target",
          card(`Meta diária (${today})`, [`Mês: ${month}`, `Gasto: ${formatBRL(summary.total)}`, `Restante: ${formatBRL(remainingBudget)}`, `Meta de hoje: ${formatBRL(targetDaily)}`])
        );
      }
    }

    if (hh === 22 && mm >= 0 && mm <= 1) {
      const month = monthDefault();
      const summary = getMonthSummary(month);
      if (summary) {
        const dayRow = db
          .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS totalCents FROM expenses WHERE date = ?")
          .get(today) as { totalCents: number };
        const dayTotal = fromCents(dayRow.totalCents ?? 0);
        const lines = [`Hoje: ${formatBRL(dayTotal)}`, `Mês (${month}): ${formatBRL(summary.total)}`];
        if (summary.budget !== null) lines.push(`Orçamento: ${formatBRL(summary.budget)} (${summary.budgetExceeded ? "ESTOUROU" : "ok"})`);
        if (summary.maxExpense) lines.push(`Maior do mês: ${formatBRL(summary.maxExpense.amount)} • ${summary.maxExpense.description}`);
        await sendIf("wa_last_daily_summary_date", "daily_summary", card(`Resumo diário (${today})`, lines));
      }
    }
  };

  scheduleInterval = setInterval(() => {
    void scheduleTick();
  }, 30_000);

  client.on("message", async (msg) => {
    waWebStatus.lastMessageAt = new Date().toISOString();
    const body = typeof msg.body === "string" ? msg.body : "";
    const from = typeof msg.from === "string" ? msg.from : "";
    const author = typeof msg.author === "string" ? msg.author : null;
    const fromMe = Boolean(msg.fromMe);

    console.log(
      `[wa] message from=${from} author=${author ?? "-"} fromMe=${fromMe} body=${JSON.stringify(body.slice(0, 180))}`
    );

    if (!body) {
      waWebStatus.lastRejectReason = "empty_body";
      console.log("[wa] reject: empty_body");
      return;
    }

    if (selectedChatId && from !== selectedChatId) {
      waWebStatus.lastRejectReason = `wrong_chat: ${from}`;
      console.log(`[wa] reject: wrong_chat expected=${selectedChatId} got=${from}`);
      return;
    }

    if (!selectedChatId && !params.chatId && !params.chatName && !fromMe && !allowedFromDigits.length) {
      waWebStatus.lastRejectReason = "not_from_me_without_filters";
      console.log("[wa] reject: not_from_me_without_filters");
      return;
    }

    if (allowedFromDigits.length) {
      const directSender = normalizeWaIdToDigits(from);
      const groupSender = author ? normalizeWaIdToDigits(author) : null;
      const senderDigits = groupSender ?? directSender;
      const senderVariants = brVariantNumbers(senderDigits);
      const isAllowed = senderVariants.some((v) => allowedFromSet.has(v));
      if (!isAllowed) {
        waWebStatus.lastRejectReason = `wrong_sender: ${senderDigits}`;
        console.log(
          `[wa] reject: wrong_sender expected=${allowedFromDigits.join(",")} got=${senderDigits} variants=${senderVariants.join(",")}`
        );
        return;
      }
    }

    notifyChatId = selectedChatId ?? from;
    if (notifyChatId) setSetting("wa_notify_chat_id", notifyChatId);

    const cmd = handleCommand(body);
    if (cmd) {
      waWebStatus.lastAcceptedAt = new Date().toISOString();
      waWebStatus.lastRejectReason = null;
      await msg.reply(cmd);
      console.log("[wa] replied(command)");
      return;
    }

    const parsedInput = parseExpenseInput(body);
    if (!parsedInput) {
      waWebStatus.lastRejectReason = "not_gasto_format";
      console.log("[wa] ignore: not_gasto_format");
      return;
    }

    const date = parsedInput.dateISO;
    const month = monthOf(date) ?? date.slice(0, 7);
    const beforeBudget = getBudgetState(month);
    const category = parsedInput.category;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    db.prepare(
      "INSERT INTO expenses(id, date, description, category, amount_cents, source, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)"
    ).run(id, date, parsedInput.description, category, toCents(parsedInput.amount), "whatsapp", now);

    const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as ExpenseRow;
    emitEvent("expense_created", { expense: mapExpenseRow(row) });
    waWebStatus.lastAcceptedAt = new Date().toISOString();
    waWebStatus.lastRejectReason = null;
    console.log(`[wa] saved id=${id} date=${date} amount=${parsedInput.amount.toFixed(2)} category=${category}`);

    const afterBudget = getBudgetState(month);
    if (beforeBudget && afterBudget && beforeBudget.exceeded !== afterBudget.exceeded) {
      emitEvent("budget_exceeded", { month, exceeded: afterBudget.exceeded });
    }

    setSetting("wa_last_expense_id", id);

    if (beforeBudget && afterBudget && !beforeBudget.exceeded && afterBudget.exceeded) {
      try {
        await msg.reply(card("Orçamento estourou", [`Mês: ${month}`, `Orçamento: ${afterBudget.budgetCents !== null ? formatBRL(fromCents(afterBudget.budgetCents)) : "-"}`, `Gasto: ${formatBRL(fromCents(afterBudget.totalCents))}`]));
      } catch (e) {
        console.log(`[wa] budget_exceeded_reply_error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const reply = card("Registrado", [
      `${formatBRL(parsedInput.amount)} • ${category}`,
      `${date}`,
      parsedInput.description
    ]);
    await msg.reply(reply);
    console.log("[wa] replied");
  });

  client.initialize();
}
