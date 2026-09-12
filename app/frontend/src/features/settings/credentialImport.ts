export type ImportedCredentials = {
  yummyPublicToken?: string;
  kodikPublicKey?: string;
  kodikPrivateKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
};

export type ImportedCredentialName = keyof ImportedCredentials;

export type CredentialCheckStatus = "valid" | "invalid" | "pending";

export type CredentialCheck = {
  field: ImportedCredentialName;
  label: string;
  status: CredentialCheckStatus;
  detail: string;
};

export type CredentialSaveOutcome = {
  saved: boolean;
  checks: CredentialCheck[];
};

export const CREDENTIAL_JSON_EXAMPLE = `{
  "yummyPublicToken": "ВАШ_YUMMY_PUBLIC_TOKEN",
  "kodikPublicKey": "ВАШ_KODIK_PUBLIC_KEY",
  "kodikPrivateKey": "ВАШ_KODIK_PRIVATE_KEY",
  "googleClientId": "ВАШ_GOOGLE_CLIENT_ID",
  "googleClientSecret": "ВАШ_GOOGLE_CLIENT_SECRET"
}`;

export const CREDENTIAL_TEXT_EXAMPLE = `YUMMY_PUBLIC_TOKEN=ВАШ_YUMMY_PUBLIC_TOKEN
KODIK_PUBLIC_KEY=ВАШ_KODIK_PUBLIC_KEY
KODIK_PRIVATE_KEY=ВАШ_KODIK_PRIVATE_KEY
GOOGLE_CLIENT_ID=ВАШ_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=ВАШ_GOOGLE_CLIENT_SECRET`;

/** Keep a local OAuth draft stable while background status polling continues. */
export function mergePolledClientId(savedValue: string, draftValue: string, draftDirty: boolean) {
  return draftDirty ? draftValue : savedValue;
}

const FIELD_LABELS: Record<ImportedCredentialName, string> = {
  yummyPublicToken: "YummyAnime Public token",
  kodikPublicKey: "Kodik Public key",
  kodikPrivateKey: "Kodik Private key",
  googleClientId: "Google Client ID",
  googleClientSecret: "Google Client Secret",
};

const EXACT_ALIASES: Record<string, ImportedCredentialName> = {
  yummypublictoken: "yummyPublicToken",
  yummyanimepublictoken: "yummyPublicToken",
  yummytoken: "yummyPublicToken",
  yummyanimetoken: "yummyPublicToken",
  yummytokenapi: "yummyPublicToken",
  токенyummyanime: "yummyPublicToken",
  токенyummy: "yummyPublicToken",

  kodikpublickey: "kodikPublicKey",
  kodikpublic: "kodikPublicKey",
  kodiktoken: "kodikPublicKey",
  публичныйключkodik: "kodikPublicKey",

  kodikprivatekey: "kodikPrivateKey",
  kodikprivate: "kodikPrivateKey",
  kodiksecret: "kodikPrivateKey",
  приватныйключkodik: "kodikPrivateKey",

  googleclientid: "googleClientId",
  googleoauthclientid: "googleClientId",
  gdriveclientid: "googleClientId",
  clientid: "googleClientId",

  googleclientsecret: "googleClientSecret",
  googleoauthclientsecret: "googleClientSecret",
  gdriveclientsecret: "googleClientSecret",
  clientsecret: "googleClientSecret",
};

function normalizeKey(value: string) {
  return value.toLocaleLowerCase("ru").replace(/[^a-zа-яё0-9]+/g, "");
}

function resolveField(path: string[]): ImportedCredentialName | undefined {
  const normalized = path.map(normalizeKey).filter(Boolean);
  const last = normalized.at(-1) ?? "";
  const joined = normalized.join("");

  // Prefer the full path so nested objects such as { kodik: { publicKey } }
  // remain unambiguous. The leaf aliases cover the documented flat format.
  const exact = EXACT_ALIASES[joined] ?? EXACT_ALIASES[last];
  if (exact) return exact;

  const context = normalized.slice(0, -1).join("");
  if (context.includes("kodik")) {
    if (["public", "publickey", "token", "apikey"].includes(last)) return "kodikPublicKey";
    if (["private", "privatekey", "secret", "secretkey"].includes(last)) return "kodikPrivateKey";
  }
  if (context.includes("yummy")) {
    if (["public", "publictoken", "token", "apikey"].includes(last)) return "yummyPublicToken";
  }
  if (
    context.includes("google")
    || context.includes("gdrive")
    || context.includes("oauth")
    || context.includes("installed")
    || context.includes("web")
  ) {
    if (["id", "clientid"].includes(last)) return "googleClientId";
    if (["secret", "clientsecret"].includes(last)) return "googleClientSecret";
  }
  return undefined;
}

function cleanValue(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const trimmed = String(value).trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function collectJson(
  value: unknown,
  target: ImportedCredentials,
  path: string[] = [],
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectJson(entry, target, [...path, String(index)]));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => collectJson(entry, target, [...path, key]));
    return;
  }

  const field = resolveField(path);
  const credential = cleanValue(value);
  if (field && credential) target[field] = credential;
}

function collectText(text: string, target: ImportedCredentials) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//") || line.startsWith(";")) continue;
    const match = line.match(/^([^:=]+?)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    const field = resolveField([match[1]]);
    const credential = cleanValue(match[2]);
    if (field && credential) target[field] = credential;
  }
}

/**
 * Parse a local credentials bundle without logging or persisting its contents.
 * Both the documented flat format and Google Cloud's downloaded OAuth JSON are
 * accepted so the same file picker works in desktop browsers and Android WebView.
 */
export function parseCredentialImport(text: string): ImportedCredentials {
  const source = text.replace(/^\uFEFF/, "").trim();
  if (!source) throw new Error("Файл ключей пуст.");

  const credentials: ImportedCredentials = {};
  if (source.startsWith("{") || source.startsWith("[")) {
    try {
      collectJson(JSON.parse(source), credentials);
    } catch {
      throw new Error("JSON с ключами повреждён или имеет неверный формат.");
    }
  } else {
    collectText(source, credentials);
  }

  if (!Object.values(credentials).some(Boolean)) {
    throw new Error(
      "Не найдены поддерживаемые поля: yummyPublicToken, kodikPublicKey, kodikPrivateKey, googleClientId, googleClientSecret.",
    );
  }
  return credentials;
}

export function importedCredentialLabels(credentials: ImportedCredentials): string[] {
  return (Object.keys(FIELD_LABELS) as ImportedCredentialName[])
    .filter(key => Boolean(credentials[key]))
    .map(key => FIELD_LABELS[key]);
}
