import * as crypto from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";

// Node 24.7+ has native Argon2; the pinned Node 24.0 declarations predate it.
const argon2 = (
  crypto as unknown as {
    argon2: (
      algorithm: "argon2id",
      parameters: {
        message: string;
        nonce: Buffer;
        memory: number;
        passes: number;
        parallelism: number;
        tagLength: number;
      },
      callback: (error: Error | null, key: Buffer) => void,
    ) => void;
  }
).argon2;
let activeHashes = 0;
async function derive(password: string, salt: Buffer) {
  if (activeHashes >= 4) throw new ServiceUnavailableException("Authentication busy. Try again.");
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      argon2(
        "argon2id",
        { message: password, nonce: salt, memory: 65536, passes: 3, parallelism: 1, tagLength: 32 },
        (error, key) => (error ? reject(error) : resolve(key)),
      );
    });
  } finally {
    activeHashes--;
  }
}
export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt);
  return `$argon2id$v=19$m=65536,t=3,p=1$${salt.toString("base64").replace(/=+$/, "")}$${key.toString("base64").replace(/=+$/, "")}`;
}
export async function verifyPassword(password: string, hash: string | null) {
  const match = hash?.match(
    /^\$argon2id\$v=19\$m=65536,t=3,p=1\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/,
  );
  const key = await derive(
    password,
    match ? Buffer.from(match[1]!, "base64") : Buffer.alloc(16, 1),
  );
  return !!match && crypto.timingSafeEqual(key, Buffer.from(match[2]!, "base64"));
}
export const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const csrfToken = (token: string) => digest("animesoul-csrf:" + token);

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = 0,
    buffer = 0,
    result = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >>> bits) & 31];
    }
  }
  return result;
}
function decodeBase32(secret: string) {
  let bits = 0,
    buffer = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Invalid TOTP secret.");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}
export function totp(secret: string, counter: number) {
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(counter));
  const hash = crypto.createHmac("sha1", decodeBase32(secret)).update(time).digest();
  const offset = hash[19]! & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
export function totpCounter(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const counter of [current - 1, current, current + 1]) {
    if (crypto.timingSafeEqual(Buffer.from(totp(secret, counter)), Buffer.from(code)))
      return counter;
  }
  return null;
}
export function encryptSecret(secret: string, key: string, userId: string) {
  if (!key) throw new ServiceUnavailableException("MFA is not configured.");
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), nonce);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), data].map((v) => v.toString("base64url")).join(".");
}
export function decryptSecret(value: string, key: string, userId: string) {
  if (!key) throw new ServiceUnavailableException("MFA is not configured.");
  const [nonce, tag, data] = value.split(".").map((v) => Buffer.from(v, "base64url"));
  if (!nonce || !tag || !data) throw new Error("Invalid encrypted MFA credential.");
  const cipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), nonce);
  cipher.setAAD(Buffer.from(userId));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
