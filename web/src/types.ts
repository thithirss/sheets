export type Expense = {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  source: "manual" | "whatsapp";
  createdAt: string;
};

export type MonthSummary = {
  month: string;
  from: string;
  to: string;
  total: number;
  averageDaily: number;
  maxExpense: { amount: number; description: string; date: string; category: string } | null;
  projectionEndOfMonth: number;
  byCategory: Array<{ category: string; total: number }>;
  byDay: Array<{ date: string; total: number }>;
  budget: number | null;
  budgetExceeded: boolean;
};

