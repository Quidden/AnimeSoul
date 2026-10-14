import type { Diagnostic } from "./sanitize.mjs";
export type DiagnosticEvent = Diagnostic & { id: string; time: string };
export function diagnosticsDirectory(): string;
export function writeDiagnostic(input: unknown): Promise<string>;
export function readDiagnostics(filters?: {
  userId?: string;
  source?: string;
  query?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: DiagnosticEvent[]; total: number; page: number; pageSize: number }>;
