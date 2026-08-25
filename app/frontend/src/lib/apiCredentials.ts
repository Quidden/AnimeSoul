export type YummyCredentialsStatus = {
  configured: boolean;
};

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({ detail: fallback }));
  return new Error(typeof payload?.detail === "string" ? payload.detail : fallback);
}

export async function fetchYummyCredentials(): Promise<YummyCredentialsStatus> {
  const response = await fetch("/api/yummy/credentials", { cache: "no-store" });
  if (!response.ok) throw await responseError(response, "Не удалось проверить ключ YummyAnime.");
  return response.json();
}

export async function saveYummyCredentials(token: string): Promise<YummyCredentialsStatus> {
  const response = await fetch("/api/yummy/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw await responseError(response, "Не удалось сохранить ключ YummyAnime.");
  return response.json();
}
