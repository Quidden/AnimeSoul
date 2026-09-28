import type { ReactNode } from "react";
import { navigateTo } from "../navigation/routes";

export function CatalogLink({ filters = {}, children }: { filters?: Record<string, string>; children: ReactNode }) {
  const search = new URLSearchParams(filters).toString();
  const href = `/catalog${search ? `?${search}` : ""}`;
  return <a href={href} onClick={event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateTo(href);
    window.scrollTo({ top: 0 });
  }}>{children}</a>;
}
