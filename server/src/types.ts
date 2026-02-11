export type Expense = {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  source: "manual" | "whatsapp";
  createdAt: string;
};

export type ExpenseRow = {
  id: string;
  date: string;
  description: string;
  category: string;
  amount_cents: number;
  source: "manual" | "whatsapp";
  created_at: string;
};
