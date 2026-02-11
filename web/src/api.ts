import type { Expense, MonthSummary } from "./types";

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export type ExpenseQuery = {
  month?: string;
  from?: string;
  to?: string;
  category?: string;
  min?: string;
  max?: string;
};

export async function listExpenses(query: ExpenseQuery): Promise<Expense[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v) params.set(k, v);
  }
  const data = await http<{ items: Expense[] }>(`/api/expenses?${params.toString()}`);
  return data.items;
}

export async function createExpense(input: { date: string; description: string; amount: number; category?: string }): Promise<Expense> {
  const data = await http<{ item: Expense }>("/api/expenses", { method: "POST", body: JSON.stringify(input) });
  return data.item;
}

export async function updateExpense(id: string, input: Partial<{ date: string; description: string; amount: number; category: string }>): Promise<Expense> {
  const data = await http<{ item: Expense }>(`/api/expenses/${id}`, { method: "PUT", body: JSON.stringify(input) });
  return data.item;
}

export async function deleteExpense(id: string): Promise<void> {
  await http<{ ok: boolean }>(`/api/expenses/${id}`, { method: "DELETE" });
}

export async function getStats(month: string): Promise<MonthSummary> {
  const params = new URLSearchParams({ month });
  return await http<MonthSummary>(`/api/stats?${params.toString()}`);
}

export async function getHistory(until: string, months = 12): Promise<Array<{ month: string; total: number }>> {
  const params = new URLSearchParams({ until, months: String(months) });
  const data = await http<{ items: Array<{ month: string; total: number }> }>(`/api/history?${params.toString()}`);
  return data.items;
}

export async function getPhoneSetting(): Promise<{ phone: string | null }> {
  return await http<{ phone: string | null }>("/api/settings");
}

export async function setPhoneSetting(phone: string): Promise<void> {
  await http<{ ok: boolean }>("/api/settings/phone", { method: "POST", body: JSON.stringify({ phone }) });
}

export async function getBudget(month: string): Promise<{ month: string; amount: number | null }> {
  const params = new URLSearchParams({ month });
  return await http<{ month: string; amount: number | null }>(`/api/budget?${params.toString()}`);
}

export async function setBudget(month: string, amount: number): Promise<void> {
  await http<{ ok: boolean }>("/api/budget", { method: "POST", body: JSON.stringify({ month, amount }) });
}

