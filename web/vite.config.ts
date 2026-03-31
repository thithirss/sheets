import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:5176",
      "/webhook": "http://localhost:5176",
      "/health": "http://localhost:5176"
    }
  }
});

