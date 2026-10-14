export type Diagnostic = {
  source: "browser" | "web" | "api";
  kind: "runtime" | "rejection" | "boundary" | "request" | "player";
  severity: "error" | "warning";
  path: string;
  message: string;
  stack: string;
  digest: string;
  code: string;
  sessionId: string;
  userId: string | null;
  browser: string;
  breadcrumbs: { kind: "navigation" | "request"; path: string; status?: number }[];
};
export function diagnosticPath(value: unknown): string;
export function diagnosticText(value: unknown, limit?: number): string;
export function diagnosticError(
  error: unknown,
): Pick<Diagnostic, "message" | "stack" | "digest" | "code">;
export function normalizeDiagnostic(input: unknown): Diagnostic;
