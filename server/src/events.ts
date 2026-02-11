import type { Response } from "express";

type Client = { id: string; res: Response };

const clients = new Map<string, Client>();

export function addSseClient(id: string, res: Response): void {
  clients.set(id, { id, res });
}

export function removeSseClient(id: string): void {
  clients.delete(id);
}

export function emitEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients.values()) {
    client.res.write(payload);
  }
}
