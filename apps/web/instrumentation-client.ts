import { diagnosticNavigation, initializeClientDiagnostics } from "./lib/diagnostics-client";

initializeClientDiagnostics();
export function onRouterTransitionStart(url: string) {
  diagnosticNavigation(url);
}
