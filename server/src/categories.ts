const rules: Array<{ category: string; keywords: string[] }> = [
  { category: "Alimentação", keywords: ["almoço", "jantar", "lanche", "pizza", "restaurante", "ifood", "hamburg", "café", "padaria", "mercado", "supermerc", "lanchonete"] },
  { category: "Transporte", keywords: ["uber", "99", "gasolina", "combust", "ônibus", "metro", "metrô", "passagem", "estacion", "pedágio", "taxi"] },
  { category: "Moradia", keywords: ["aluguel", "condom", "energia", "luz", "água", "internet", "telefone", "gás", "reforma", "móveis", "mobilia"] },
  { category: "Saúde", keywords: ["farmácia", "remédio", "consulta", "exame", "hospital", "plano", "dent", "psico"] },
  { category: "Educação", keywords: ["curso", "livro", "faculdade", "escola", "udemy", "alura", "mensalidade"] },
  { category: "Lazer", keywords: ["cinema", "show", "netflix", "spotify", "jogo", "bar", "viagem", "hotel"] },
  { category: "Compras", keywords: ["loja", "roupa", "sapato", "amazon", "shopee", "mercadolivre", "eletr", "presente"] },
  { category: "Contas", keywords: ["boleto", "cartão", "cartao", "juros", "taxa", "tarifa", "anuidade"] }
];

export function categorizeExpense(description: string): string {
  const text = description.toLowerCase();
  for (const rule of rules) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.category;
  }
  return "Outros";
}

export const categories = ["Alimentação", "Transporte", "Moradia", "Saúde", "Educação", "Lazer", "Compras", "Contas", "Outros"] as const;
