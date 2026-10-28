import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the built folder works from any static host or sub-path. In development the
// API (npm run api, port 8787 unless PORT says otherwise) answers /api behind the Vite server.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { proxy: { "/api": `http://localhost:${process.env.PORT ?? 8787}` } },
});
