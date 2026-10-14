export const accountSectionIds = [
  "profile-settings",
  "media-settings",
  "privacy-settings",
  "player-settings",
  "security-settings",
  "identity-settings",
  "appearance-settings",
] as const;
export type AccountSection = (typeof accountSectionIds)[number];

export function accountSettingsHref(section: AccountSection) {
  return "/account?section=" + section + "#" + section;
}

export function accountSectionFromUrl(url: URL): AccountSection | null {
  if (url.hash.includes("action=") || url.searchParams.has("oauth")) return "identity-settings";
  const hash = url.hash.slice(1);
  return (
    accountSectionIds.find((id) => id === hash) ??
    accountSectionIds.find((id) => id === url.searchParams.get("section")) ??
    null
  );
}
