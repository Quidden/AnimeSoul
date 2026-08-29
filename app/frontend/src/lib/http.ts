type ErrorMessage = string | ((status: number) => string);

export type JsonRequestInit = RequestInit & {
  errorMessage?: ErrorMessage;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function errorRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
}

function errorText(payload: Record<string, unknown>, fallback: string): string {
  if (typeof payload.detail === "string" && payload.detail) return payload.detail;
  if (typeof payload.error === "string" && payload.error) return payload.error;
  return fallback;
}

/** Fetch a JSON endpoint while preserving the backend's error message and status. */
export async function requestJson<T>(
  input: RequestInfo | URL,
  options: JsonRequestInit = {},
): Promise<T> {
  const { errorMessage, ...init } = options;
  const response = await fetch(input, init);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (response.ok) throw error;
    payload = {};
  }

  if (!response.ok) {
    const record = errorRecord(payload);
    const fallback = typeof errorMessage === "function"
      ? errorMessage(response.status)
      : errorMessage || `API request failed with status ${response.status}`;
    throw new ApiRequestError(
      errorText(record, fallback),
      response.status,
      typeof record.code === "string" ? record.code : undefined,
    );
  }
  return payload as T;
}
