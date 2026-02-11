import { useEffect, useRef, useState } from "react";

export type SseEvent =
  | { type: "expense_created"; expense: { id: string } }
  | { type: "expense_updated"; expense: { id: string } }
  | { type: "expense_deleted"; id: string }
  | { type: "budget_updated"; month: string; amount: number }
  | { type: "budget_exceeded"; month: string; exceeded: boolean }
  | { type: "ping" };

export function useSse(): { lastEvent: SseEvent | null; status: "connecting" | "open" | "closed" } {
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [lastEvent, setLastEvent] = useState<SseEvent | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
    const asExpenseId = (v: unknown): { id: string } | null => {
      const o = asObj(v);
      const id = o?.id;
      if (typeof id !== "string") return null;
      return { id };
    };
    const parseJsonObj = (input: string): Record<string, unknown> | null => {
      try {
        return asObj(JSON.parse(input));
      } catch {
        return null;
      }
    };

    const source = new EventSource("/api/stream");
    sourceRef.current = source;
    setStatus("connecting");

    source.addEventListener("open", () => setStatus("open"));
    source.addEventListener("error", () => setStatus("closed"));

    const handlers: Array<{ type: SseEvent["type"]; fn: (e: MessageEvent) => void }> = [
      {
        type: "expense_created",
        fn: (e) => {
          const data = parseJsonObj(String(e.data));
          const expense = asExpenseId(data?.expense);
          if (!expense) return;
          setLastEvent({ type: "expense_created", expense });
        }
      },
      {
        type: "expense_updated",
        fn: (e) => {
          const data = parseJsonObj(String(e.data));
          const expense = asExpenseId(data?.expense);
          if (!expense) return;
          setLastEvent({ type: "expense_updated", expense });
        }
      },
      {
        type: "expense_deleted",
        fn: (e) => {
          const data = parseJsonObj(String(e.data));
          const id = data?.id;
          if (typeof id !== "string") return;
          setLastEvent({ type: "expense_deleted", id });
        }
      },
      {
        type: "budget_updated",
        fn: (e) => {
          const data = parseJsonObj(String(e.data));
          const month = data?.month;
          const amount = data?.amount;
          if (typeof month !== "string" || typeof amount !== "number") return;
          setLastEvent({ type: "budget_updated", month, amount });
        }
      },
      {
        type: "budget_exceeded",
        fn: (e) => {
          const data = parseJsonObj(String(e.data));
          const month = data?.month;
          const exceeded = data?.exceeded;
          if (typeof month !== "string" || typeof exceeded !== "boolean") return;
          setLastEvent({ type: "budget_exceeded", month, exceeded });
        }
      },
      {
        type: "ping",
        fn: () => setLastEvent({ type: "ping" })
      }
    ];

    for (const h of handlers) source.addEventListener(h.type, h.fn);

    return () => {
      for (const h of handlers) source.removeEventListener(h.type, h.fn);
      source.close();
      sourceRef.current = null;
    };
  }, []);

  return { lastEvent, status };
}
