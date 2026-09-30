import { useSyncExternalStore } from "react";
import { IS_ANDROID_APP } from "../lib/platform";

const query = "(max-width: 800px)";
export const isMobileLayout = () => IS_ANDROID_APP || window.matchMedia(query).matches;
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
export function useMobileLayout() {
  return useSyncExternalStore(subscribe, isMobileLayout, () => false);
}
