import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? "5175"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  dataDir: process.env.DATA_DIR ?? "data",
  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "devtoken",
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID
  },
  waWeb: {
    enabled: process.env.WA_WEB_ENABLED === "1",
    chatName: process.env.WA_WEB_CHAT_NAME,
    chatId: process.env.WA_WEB_CHAT_ID,
    allowedFrom: process.env.WA_WEB_ALLOWED_FROM
  }
};
