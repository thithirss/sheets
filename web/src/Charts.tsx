import { Bar, Line, Pie } from "react-chartjs-2";
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  ArcElement,
  BarElement
} from "chart.js";
import type { MonthSummary } from "./types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, ArcElement, BarElement);

function colors(n: number): string[] {
  const base = ["#6aa5ff", "#48d597", "#ffcc66", "#ff6a7a", "#b38cff", "#66d9ff", "#ff9f66", "#7cff9b", "#ffd166"];
  const result: string[] = [];
  for (let i = 0; i < n; i++) result.push(base[i % base.length]);
  return result;
}

export function Charts({ summary }: { summary: MonthSummary | null }) {
  if (!summary) return null;

  const catLabels = summary.byCategory.map((c) => c.category);
  const catTotals = summary.byCategory.map((c) => c.total);
  const dayLabels = summary.byDay.map((d) => d.date.slice(8, 10));
  const dayTotals = summary.byDay.map((d) => d.total);

  const palette = colors(catLabels.length);

  return (
    <div className="grid grid-3">
      <div className="panel section">
        <h2>Categorias (pizza)</h2>
        <Pie
          data={{
            labels: catLabels,
            datasets: [{ data: catTotals, backgroundColor: palette, borderColor: "rgba(0,0,0,0)", borderWidth: 0 }]
          }}
          options={{
            responsive: true,
            plugins: { legend: { position: "bottom", labels: { color: "#aab7da" } } }
          }}
        />
      </div>
      <div className="panel section">
        <h2>Evolução (linha)</h2>
        <Line
          data={{
            labels: dayLabels,
            datasets: [
              {
                label: "Total por dia",
                data: dayTotals,
                borderColor: "#6aa5ff",
                backgroundColor: "rgba(106,165,255,0.15)",
                tension: 0.25,
                fill: true
              }
            ]
          }}
          options={{
            responsive: true,
            scales: {
              x: { ticks: { color: "#aab7da" }, grid: { color: "rgba(255,255,255,0.06)" } },
              y: { ticks: { color: "#aab7da" }, grid: { color: "rgba(255,255,255,0.06)" } }
            },
            plugins: { legend: { labels: { color: "#aab7da" } } }
          }}
        />
      </div>
      <div className="panel section">
        <h2>Comparativo (barras)</h2>
        <Bar
          data={{
            labels: catLabels,
            datasets: [{ label: "Total por categoria", data: catTotals, backgroundColor: palette }]
          }}
          options={{
            responsive: true,
            scales: {
              x: { ticks: { color: "#aab7da" }, grid: { color: "rgba(255,255,255,0.06)" } },
              y: { ticks: { color: "#aab7da" }, grid: { color: "rgba(255,255,255,0.06)" } }
            },
            plugins: { legend: { labels: { color: "#aab7da" } } }
          }}
        />
      </div>
    </div>
  );
}

