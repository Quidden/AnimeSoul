import { trialDays } from "@animesoul/contracts";
export function registrationTrial(now = new Date()) {
  return { startedAt: now, expiresAt: new Date(now.getTime() + trialDays * 86400000) };
}
