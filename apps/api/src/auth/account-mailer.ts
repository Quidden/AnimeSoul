import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { Configuration } from "../config.js";
export type AccountMail = { to: string; subject: string; text: string };
export type MailDelivery = (mail: AccountMail) => Promise<void>;
export const ACCOUNT_MAIL = Symbol("ACCOUNT_MAIL");
/** File delivery is an explicit local substitute, never a public mail endpoint. */
export function accountMailDelivery(config: Configuration): MailDelivery {
  if (config.MAIL_MODE === "file") {
    if (
      config.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.SITE_URL).hostname)
    )
      throw new Error("Mail files require a local development site.");
    return async (mail) => {
      const dir = fileURLToPath(new URL("../../../../artifacts/dev-mail/", import.meta.url));
      await mkdir(dir, { recursive: true });
      await writeFile(
        new URL(
          randomUUID() + ".json",
          new URL("../../../../artifacts/dev-mail/", import.meta.url),
        ),
        JSON.stringify(mail, null, 2),
        { flag: "wx", mode: 0o600 },
      );
    };
  }
  if (config.MAIL_MODE === "smtp") {
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE === "true",
      requireTLS: config.SMTP_SECURE !== "true",
      ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    return async (mail) => {
      await transport.sendMail({ from: config.SMTP_FROM, ...mail });
    };
  }
  return async () => {
    throw new Error("Mail is disabled.");
  };
}
