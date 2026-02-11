import { Router } from "express";
import { waWebStatus } from "../waWeb.js";

export const waStatusRouter = Router();

waStatusRouter.get("/wa-status", (_req, res) => {
  res.json(waWebStatus);
});

