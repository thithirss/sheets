import crypto from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import { addSseClient, removeSseClient } from "../events.js";

export const streamRouter = Router();

streamRouter.get("/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const id = crypto.randomUUID();
  addSseClient(id, res);

  const keepAlive = setInterval(() => {
    res.write(`event: ping\ndata: {}\n\n`);
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    removeSseClient(id);
  });
});

