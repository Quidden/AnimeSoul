import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// React and FastAPI run separately in development. Relative URLs are used in
// application code so the same frontend also works when served by FastAPI.
export default defineConfig(() => {
  // Android is built by Gradle. Its assets must not overwrite `dist`, which
  // FastAPI serves to the desktop app. Otherwise the desktop starts the
  // Android bundle and receives its platform-specific layout.
  const androidBundle = process.env.VITE_ANIMESOUL_PLATFORM === "android";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": "http://127.0.0.1:8000",
        "/watch-party": "http://127.0.0.1:8000",
        "/ws": { target: "ws://127.0.0.1:8000", ws: true }
      }
    },
    build: {
      outDir: androidBundle ? "dist-android" : "dist",
      emptyOutDir: true,
      // The only chunk above the default ceiling is the lazy full HLS runtime.
      // The light build omits alternate audio and subtitles used by the player.
      chunkSizeWarningLimit: 580,
      // The local debug journal resolves production stack frames back to the
      // original TS/TSX function, file and line. Maps remain on localhost.
      sourcemap: true,
      rollupOptions: {
        output: {
          // Keep the framework cacheable across AnimeSoul releases and avoid
          // making every UI change invalidate one oversized application file.
          manualChunks(id) {
            if (
              id.includes("/node_modules/react/")
              || id.includes("/node_modules/react-dom/")
              || id.includes("/node_modules/scheduler/")
            ) return "react-vendor";
          },
        },
      },
    }
  };
});
