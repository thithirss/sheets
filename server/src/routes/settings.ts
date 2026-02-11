import { Router } from "express";
import { z } from "zod";
import { getSetting, setSetting } from "../db.js";

export const settingsRouter = Router();

settingsRouter.get("/settings", (_req, res) => {
  const phone = getSetting("phone");
  res.json({ phone });
});

const phoneSchema = z.object({
  phone: z.string().min(7)
});

settingsRouter.post("/settings/phone", (req, res) => {
  const parsed = phoneSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Telefone inválido.", details: parsed.error.flatten() });
    return;
  }
  setSetting("phone", parsed.data.phone.trim());
  res.json({ ok: true });
});

