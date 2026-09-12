import type { CredentialCheck } from "../features/settings/credentialImport";
import { requestJson } from "./http";

export type YummyCredentialsStatus = {
  configured: boolean;
  saved?: boolean;
  checks?: CredentialCheck[];
};

export async function fetchYummyCredentials(): Promise<YummyCredentialsStatus> {
  return requestJson("/api/yummy/credentials", {
    cache: "no-store",
    errorMessage: "Не удалось проверить ключ YummyAnime.",
  });
}

export async function saveYummyCredentials(token: string): Promise<YummyCredentialsStatus> {
  return requestJson("/api/yummy/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    errorMessage: "Не удалось сохранить ключ YummyAnime.",
  });
}
