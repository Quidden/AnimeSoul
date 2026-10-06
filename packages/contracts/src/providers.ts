export type ProviderDecision =
  | "enabled"
  | "disabled"
  | "environment-blocked"
  | "missing-credentials";
/** Deployment restrictions take precedence over stored administrator settings. */
export function providerDecision(input: {
  environmentAllows: boolean;
  settingEnabled: boolean;
  hasCredentials: boolean;
}): ProviderDecision {
  if (!input.environmentAllows) return "environment-blocked";
  if (!input.settingEnabled) return "disabled";
  return input.hasCredentials ? "enabled" : "missing-credentials";
}
