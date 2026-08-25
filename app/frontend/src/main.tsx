import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";
import { installDebugCapture } from "./lib/debugLog";
import { IS_ANDROID_APP } from "./lib/platform";

// React owns the UI; persistent data and external API calls go to FastAPI.
if (IS_ANDROID_APP) document.documentElement.dataset.platform = "android";
installDebugCapture();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
