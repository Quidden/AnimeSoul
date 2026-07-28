import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// React and FastAPI run separately in development. Relative URLs are used in
// application code so the same frontend also works when served by FastAPI.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/watch-party": "http://127.0.0.1:8000",
      "/ws": { target: "ws://127.0.0.1:8000", ws: true }
    }
  },
  build: { outDir: "dist", emptyOutDir: true }
});
