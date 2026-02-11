import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createExpense,
  deleteExpense,
  getBudget,
  getHistory,
  getPhoneSetting,
  getStats,
  listExpenses,
  setBudget,
  setPhoneSetting,
  updateExpense
} from "./api";
import { Charts } from "./Charts";
import { History } from "./History";
import { exportToExcel, exportToPdf } from "./exporters";
import { firstDay, formatBRL, lastDay, monthNow } from "./lib";
import type { Expense, MonthSummary } from "./types";
import { useSse } from "./useSse";

type Filters = {
  month: string;
  from: string;
  to: string;
  category: string;
  min: string;
  max: string;
};

function asNumber(input: string): number | null {
  const n = Number(input.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export default function App() {
  const { lastEvent, status: sseStatus } = useSse();

  const [filters, setFilters] = useState<Filters>(() => {
    const month = monthNow();
    return { month, from: firstDay(month), to: lastDay(month), category: "", min: "", max: "" };
  });

  const [items, setItems] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [history, setHistory] = useState<Array<{ month: string; total: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newExpense, setNewExpense] = useState<{ date: string; description: string; amount: string; category: string }>(() => ({
    date: new Date().toISOString().slice(0, 10),
    description: "",
    amount: "",
    category: ""
  }));

  const [budget, setBudgetState] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [settingsSaved, setSettingsSaved] = useState<"idle" | "saving" | "saved">("idle");

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const refreshInFlight = useRef(false);

  const refreshAll = useCallback(async (opts?: { signal?: AbortSignal; silent?: boolean }) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;

    const signal = opts?.signal;
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [expenses, stats, hist, budgetRow] = await Promise.all([
        listExpenses({ from: filters.from, to: filters.to, category: filters.category || undefined, min: filters.min || undefined, max: filters.max || undefined }),
        getStats(filters.month),
        getHistory(filters.month, 12),
        getBudget(filters.month)
      ]);
      if (signal?.aborted) return;
      setItems(expenses);
      setSummary(stats);
      setHistory(hist);
      setBudgetState(budgetRow.amount === null ? "" : String(budgetRow.amount));
    } catch (e) {
      if (signal?.aborted) return;
      if (!silent) setError(e instanceof Error ? e.message : "Erro ao carregar.");
    } finally {
      refreshInFlight.current = false;
      if (!silent && !signal?.aborted) setLoading(false);
    }
  }, [filters.category, filters.from, filters.max, filters.min, filters.month, filters.to]);

  useEffect(() => {
    const ac = new AbortController();
    refreshAll({ signal: ac.signal });
    return () => ac.abort();
  }, [refreshAll]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      refreshAll({ silent: true });
    };
    const id = window.setInterval(tick, 3000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refreshAll]);

  useEffect(() => {
    const ac = new AbortController();
    getPhoneSetting()
      .then((r) => {
        if (!ac.signal.aborted) setPhone(r.phone ?? "");
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!lastEvent || lastEvent.type === "ping") return;
    refreshAll({ silent: true });
  }, [lastEvent, refreshAll]);

  const monthLabel = filters.month;

  async function onCreate() {
    setError(null);
    const amount = asNumber(newExpense.amount);
    if (!amount || amount <= 0) {
      setError("Informe um valor válido.");
      return;
    }
    if (!newExpense.description.trim()) {
      setError("Informe uma descrição.");
      return;
    }
    try {
      await createExpense({
        date: newExpense.date,
        description: newExpense.description.trim(),
        amount,
        category: newExpense.category.trim() || undefined
      });
      setNewExpense((s) => ({ ...s, description: "", amount: "", category: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar.");
    }
  }

  async function onUpdate(item: Expense, patch: Partial<Expense>) {
    setError(null);
    try {
      await updateExpense(item.id, {
        date: patch.date,
        description: patch.description,
        category: patch.category,
        amount: patch.amount
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao atualizar.");
    }
  }

  async function onDelete(item: Expense) {
    setError(null);
    try {
      await deleteExpense(item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao deletar.");
    }
  }

  async function onSaveBudget() {
    setError(null);
    const n = budget.trim() ? asNumber(budget) : null;
    if (n === null || n <= 0) {
      setError("Orçamento inválido.");
      return;
    }
    try {
      await setBudget(filters.month, n);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar orçamento.");
    }
  }

  async function onSavePhone() {
    setSettingsSaved("saving");
    try {
      await setPhoneSetting(phone.trim());
      setSettingsSaved("saved");
      setTimeout(() => setSettingsSaved("idle"), 1200);
    } catch {
      setSettingsSaved("idle");
    }
  }

  const alertBudget = summary?.budgetExceeded ? (
    <span className="pill badgeDanger">Orçamento ultrapassado</span>
  ) : summary?.budget !== null ? (
    <span className="pill badgeOk">Orçamento ok</span>
  ) : (
    <span className="pill">Sem orçamento</span>
  );

  return (
    <div className="container">
      <div className="header">
        <h1 className="title">Controle de Gastos</h1>
        <div className="row">
          <span className="pill">Tempo real: {sseStatus}</span>
          {alertBudget}
        </div>
      </div>

      <div className="panel section">
        <h2>Filtros</h2>
        <div className="row">
          <label className="pill">
            Mês
            <input
              type="month"
              value={filters.month}
              onChange={(e) => {
                const month = e.target.value;
                setFilters((s) => ({ ...s, month, from: firstDay(month), to: lastDay(month) }));
              }}
            />
          </label>
          <label className="pill">
            De
            <input type="date" value={filters.from} onChange={(e) => setFilters((s) => ({ ...s, from: e.target.value }))} />
          </label>
          <label className="pill">
            Até
            <input type="date" value={filters.to} onChange={(e) => setFilters((s) => ({ ...s, to: e.target.value }))} />
          </label>
          <label className="pill">
            Categoria
            <select value={filters.category} onChange={(e) => setFilters((s) => ({ ...s, category: e.target.value }))}>
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="pill">
            Min
            <input value={filters.min} placeholder="0" onChange={(e) => setFilters((s) => ({ ...s, min: e.target.value }))} style={{ width: 90 }} />
          </label>
          <label className="pill">
            Max
            <input value={filters.max} placeholder="0" onChange={(e) => setFilters((s) => ({ ...s, max: e.target.value }))} style={{ width: 90 }} />
          </label>
          <span className="spacer" />
          <button
            className="secondary"
            onClick={() => {
              const name = `gastos_${monthLabel}.xlsx`;
              exportToExcel(items, summary, name);
            }}
            disabled={!items.length}
          >
            Exportar Excel
          </button>
          <button
            className="secondary"
            onClick={() => {
              const name = `gastos_${monthLabel}.pdf`;
              exportToPdf(items, summary, `Gastos ${monthLabel}`, name);
            }}
            disabled={!items.length}
          >
            Exportar PDF
          </button>
        </div>
        {error ? <div className="error" style={{ marginTop: 10 }}>{error}</div> : null}
        {loading ? <div className="small" style={{ marginTop: 10 }}>Carregando…</div> : null}
      </div>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <div className="panel section">
          <h2>Resumo do mês ({monthLabel})</h2>
          <div className="grid grid-3">
            <div className="card">
              <p className="kpiLabel">Total</p>
              <p className="kpiValue">{summary ? formatBRL(summary.total) : "—"}</p>
              <p className="kpiSub">
                {summary ? (summary.budget !== null ? `Orçamento: ${formatBRL(summary.budget)}` : "Defina um orçamento abaixo") : "—"}
              </p>
            </div>
            <div className="card">
              <p className="kpiLabel">Média diária</p>
              <p className="kpiValue">{summary ? formatBRL(summary.averageDaily) : "—"}</p>
              <p className="kpiSub">Projeção: {summary ? formatBRL(summary.projectionEndOfMonth) : "—"}</p>
            </div>
            <div className="card">
              <p className="kpiLabel">Maior gasto</p>
              <p className="kpiValue">{summary?.maxExpense ? formatBRL(summary.maxExpense.amount) : "—"}</p>
              <p className="kpiSub">{summary?.maxExpense ? `${summary.maxExpense.date} • ${summary.maxExpense.category}` : ""}</p>
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <label className="pill">
              Orçamento do mês (R$)
              <input value={budget} placeholder="Ex: 1500" onChange={(e) => setBudgetState(e.target.value)} />
            </label>
            <button onClick={onSaveBudget}>Salvar orçamento</button>
          </div>
        </div>

        <div className="panel section">
          <h2>WhatsApp (opcional)</h2>
          <div className="small">
            Cadastre seu número para aceitar mensagens no webhook. Depois envie: <strong>GASTO 45.90 Almoço restaurante</strong>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="pill">
              Seu número (com DDI)
              <input value={phone} placeholder="Ex: 5511999999999" onChange={(e) => setPhone(e.target.value)} />
            </label>
            <button onClick={onSavePhone} disabled={settingsSaved === "saving"}>
              {settingsSaved === "saved" ? "Salvo" : settingsSaved === "saving" ? "Salvando…" : "Salvar"}
            </button>
          </div>
          <div className="small" style={{ marginTop: 10 }}>
            Endpoint de webhook: <strong>/webhook</strong>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Charts summary={summary} />
      </div>

      <div style={{ marginTop: 12 }}>
        <History items={history} />
      </div>

      <div className="panel section" style={{ marginTop: 12 }}>
        <h2>Novo gasto</h2>
        <div className="formGrid">
          <input type="date" value={newExpense.date} onChange={(e) => setNewExpense((s) => ({ ...s, date: e.target.value }))} />
          <input
            className="span2"
            value={newExpense.description}
            placeholder="Descrição"
            onChange={(e) => setNewExpense((s) => ({ ...s, description: e.target.value }))}
          />
          <input
            value={newExpense.amount}
            placeholder="Valor (ex: 45.90)"
            onChange={(e) => setNewExpense((s) => ({ ...s, amount: e.target.value }))}
          />
          <input
            className="span2"
            value={newExpense.category}
            placeholder="Categoria (opcional)"
            onChange={(e) => setNewExpense((s) => ({ ...s, category: e.target.value }))}
          />
          <div className="row">
            <button onClick={onCreate}>Adicionar</button>
          </div>
        </div>
      </div>

      <div className="panel section" style={{ marginTop: 12 }}>
        <h2>Gastos do período</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th style={{ textAlign: "right" }}>Valor</th>
                <th>Origem</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <ExpenseRow key={it.id} item={it} onUpdate={onUpdate} onDelete={onDelete} />
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={6} className="small">
                    Nenhum gasto encontrado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ExpenseRow({
  item,
  onUpdate,
  onDelete
}: {
  item: Expense;
  onUpdate: (item: Expense, patch: Partial<Expense>) => void;
  onDelete: (item: Expense) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ date: string; description: string; category: string; amount: string }>(() => ({
    date: item.date,
    description: item.description,
    category: item.category,
    amount: String(item.amount)
  }));

  useEffect(() => {
    if (!editing) {
      setDraft({ date: item.date, description: item.description, category: item.category, amount: String(item.amount) });
    }
  }, [editing, item.amount, item.category, item.date, item.description]);

  return (
    <tr>
      <td>
        {editing ? (
          <input type="date" value={draft.date} onChange={(e) => setDraft((s) => ({ ...s, date: e.target.value }))} />
        ) : (
          item.date
        )}
      </td>
      <td>
        {editing ? (
          <input value={draft.description} onChange={(e) => setDraft((s) => ({ ...s, description: e.target.value }))} />
        ) : (
          item.description
        )}
      </td>
      <td>
        {editing ? (
          <input value={draft.category} onChange={(e) => setDraft((s) => ({ ...s, category: e.target.value }))} />
        ) : (
          item.category
        )}
      </td>
      <td style={{ textAlign: "right" }}>
        {editing ? (
          <input
            value={draft.amount}
            onChange={(e) => setDraft((s) => ({ ...s, amount: e.target.value }))}
            style={{ width: 110, textAlign: "right" }}
          />
        ) : (
          formatBRL(item.amount)
        )}
      </td>
      <td>{item.source}</td>
      <td style={{ width: 180 }}>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {editing ? (
            <>
              <button
                onClick={() => {
                  const n = asNumber(draft.amount);
                  if (!n || n <= 0) return;
                  onUpdate(item, {
                    date: draft.date,
                    description: draft.description.trim(),
                    category: draft.category.trim(),
                    amount: n
                  });
                  setEditing(false);
                }}
              >
                Salvar
              </button>
              <button className="secondary" onClick={() => setEditing(false)}>
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button className="secondary" onClick={() => setEditing(true)}>
                Editar
              </button>
              <button className="danger" onClick={() => onDelete(item)}>
                Excluir
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
