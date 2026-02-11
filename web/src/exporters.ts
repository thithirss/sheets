import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Expense, MonthSummary } from "./types";
import { formatBRL } from "./lib";

export function exportToExcel(expenses: Expense[], summary: MonthSummary | null, fileName: string): void {
  const rows = expenses
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      Data: e.date,
      Descrição: e.description,
      Categoria: e.category,
      Valor: e.amount,
      Origem: e.source
    }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Gastos");

  if (summary) {
    const ws2 = XLSX.utils.json_to_sheet([
      { Campo: "Total", Valor: summary.total },
      { Campo: "Média diária", Valor: summary.averageDaily },
      { Campo: "Maior gasto", Valor: summary.maxExpense ? summary.maxExpense.amount : "" },
      { Campo: "Projeção fim do mês", Valor: summary.projectionEndOfMonth },
      { Campo: "Orçamento", Valor: summary.budget ?? "" }
    ]);
    XLSX.utils.book_append_sheet(wb, ws2, "Resumo");
  }

  XLSX.writeFile(wb, fileName);
}

export function exportToPdf(expenses: Expense[], summary: MonthSummary | null, title: string, fileName: string): void {
  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 40, 40);

  doc.setFontSize(10);
  const summaryLines: string[] = [];
  if (summary) {
    summaryLines.push(`Total: ${formatBRL(summary.total)}`);
    summaryLines.push(`Média diária: ${formatBRL(summary.averageDaily)}`);
    summaryLines.push(`Projeção fim do mês: ${formatBRL(summary.projectionEndOfMonth)}`);
    if (summary.maxExpense) summaryLines.push(`Maior: ${formatBRL(summary.maxExpense.amount)} (${summary.maxExpense.description})`);
    if (summary.budget !== null) summaryLines.push(`Orçamento: ${formatBRL(summary.budget)}`);
  }
  if (summaryLines.length) doc.text(summaryLines, 40, 62);

  const rows = expenses
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => [e.date, e.description, e.category, formatBRL(e.amount), e.source]);

  autoTable(doc, {
    startY: summaryLines.length ? 100 : 70,
    head: [["Data", "Descrição", "Categoria", "Valor", "Origem"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [25, 40, 70] },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 230 },
      2: { cellWidth: 110 },
      3: { cellWidth: 70, halign: "right" },
      4: { cellWidth: 60 }
    }
  });

  doc.save(fileName);
}

