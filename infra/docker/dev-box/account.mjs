import { readFile } from "node:fs/promises";
import { totp } from "../dist/auth/security.js";
const directory = process.env.DEV_BOX_DATA ?? "/var/lib/postgresql/animesoul-dev";
const { account } = JSON.parse(await readFile(`${directory}/private.json`, "utf8"));
const currentCode = totp(account.totpSecret, Math.floor(Date.now() / 30000));
console.info(
  JSON.stringify(
    {
      username: account.username,
      email: account.email,
      password: account.password,
      adminCode: currentCode,
      codeValidForSeconds: 30 - (Math.floor(Date.now() / 1000) % 30),
      authenticatorUri: `otpauth://totp/AnimeSoul%20Dev:${encodeURIComponent(account.email)}?secret=${account.totpSecret}&issuer=AnimeSoul%20Dev`,
    },
    null,
    2,
  ),
);
