import { env } from "./env.js";

export async function sendWhatsAppText(to: string, text: string): Promise<void> {
  if (!env.whatsapp.token || !env.whatsapp.phoneNumberId) return;

  const url = `https://graph.facebook.com/v20.0/${env.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.whatsapp.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Falha ao enviar WhatsApp: ${res.status} ${body}`);
  }
}

