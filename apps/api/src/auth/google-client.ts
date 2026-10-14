import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "zod";
import type { Configuration } from "../config.js";
export const GOOGLE_CLIENT = Symbol("GOOGLE_CLIENT");
const claims = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(254),
  email_verified: z.literal(true),
  nonce: z.string(),
  iat: z.number(),
  exp: z.number(),
  azp: z.string().optional(),
});
export class GoogleClient {
  private readonly keys;
  constructor(
    private readonly config: Configuration,
    private readonly request: typeof fetch = fetch,
  ) {
    this.keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {
      timeoutDuration: 10000,
      [customFetch]: (url, options) => request(url, { ...options, redirect: "error" }),
    });
  }
  get callbackUrl() {
    return new URL("/api/auth/google/callback", this.config.SITE_URL).href;
  }
  authorization(state: string, nonce: string, challenge: string) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.config.GOOGLE_CLIENT_ID,
      redirect_uri: this.callbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url.href;
  }
  async exchange(code: string, verifier: string, nonce: string) {
    const response = await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.GOOGLE_CLIENT_ID,
        client_secret: this.config.GOOGLE_CLIENT_SECRET,
        redirect_uri: this.callbackUrl,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    if (!response.ok) throw new Error("Google authentication rejected.");
    const text = await response.text();
    if (text.length > 65536) throw new Error("Google response rejected.");
    const tokens = z.object({ id_token: z.string().max(16384) }).parse(JSON.parse(text));
    const { payload } = await jwtVerify(tokens.id_token, this.keys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: this.config.GOOGLE_CLIENT_ID,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "nonce"],
    });
    const identity = claims.parse(payload);
    if (
      identity.nonce !== nonce ||
      identity.iat > Date.now() / 1000 + 30 ||
      (identity.azp && identity.azp !== this.config.GOOGLE_CLIENT_ID) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && !identity.azp)
    )
      throw new Error("Google identity rejected.");
    return { subject: identity.sub, email: identity.email.toLowerCase() };
  }
}
