import { Bar } from "react-chartjs-2";
import { CategoryScale, Chart as ChartJS, Legend, LinearScale, BarElement, Tooltip } from "chart.js";
import { formatBRL } from "./lib";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export function History({ items }: { items: Array<{ month: string; total: number }> }) {
  const labels = items.map((i) => i.month);
  const totals = items.map((i) => i.total);
  return (
    <div className="panel section">
      <h2>Últimos 12 meses</h2>
      <Bar
        data={{
          labels,
          datasets: [{ label: "Total por mês", data: totals, backgroundColor: "rgba(72,213,151,0.45)" }]
        }}
        options={{
          responsive: true,
          scales: {
            x: { ticks: { color: "#aab7da" }, grid: { color: "rgba(255,255,255,0.06)" } },
            y: {
              ticks: { color: "#aab7da", callback: (v) => formatBRL(Number(v)) },
              grid: { color: "rgba(255,255,255,0.06)" }
            }
          },
          plugins: { legend: { labels: { color: "#aab7da" } } }
        }}
      />
    </div>
  );
}

