import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";
import { installDebugCapture } from "./lib/debugLog";

// React owns the UI; persistent data and external API calls go to FastAPI.
installDebugCapture();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
