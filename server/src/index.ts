import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { env } from "./env.js";
import { budgetRouter } from "./routes/budget.js";
import { devRouter } from "./routes/dev.js";
import { expensesRouter } from "./routes/expenses.js";
import { settingsRouter } from "./routes/settings.js";
import { streamRouter } from "./routes/stream.js";
import { waStatusRouter } from "./routes/waStatus.js";
import { whatsappRouter } from "./routes/whatsapp.js";
import { startWhatsAppWebIngest } from "./waWeb.js";

const app = express();

app.use(
  cors({
    origin: env.corsOrigin,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/", whatsappRouter);
app.use("/api", streamRouter);
app.use("/api", expensesRouter);
app.use("/api", budgetRouter);
app.use("/api", settingsRouter);
app.use("/api", devRouter);
app.use("/api", waStatusRouter);

const rootDir = fs.existsSync(path.resolve(process.cwd(), "web")) ? process.cwd() : path.resolve(process.cwd(), "..");
const webDist = path.resolve(rootDir, "web", "dist");
const webIndex = path.join(webDist, "index.html");
if (fs.existsSync(webIndex)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(webIndex);
  });
}

app.listen(env.port, () => {
  console.log(`API: http://localhost:${env.port}`);
});

if (env.waWeb.enabled) {
  startWhatsAppWebIngest({ chatId: env.waWeb.chatId, chatName: env.waWeb.chatName, allowedFrom: env.waWeb.allowedFrom });
}
