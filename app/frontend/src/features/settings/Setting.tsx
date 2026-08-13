import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { matchesSettingsQuery } from "./settingsCatalog";

export const SettingsSearchContext = createContext("");

type SettingProps = {
  title: string;
  description: string;
  example?: string;
  searchTerms?: string;
  children: ReactNode;
};

/** A searchable settings row shared by every settings tab. */
export function Setting({ title, description, example, searchTerms, children }: SettingProps) {
  const searchQuery = useContext(SettingsSearchContext);
  const searchableText = `${title} ${description} ${example ?? ""} ${searchTerms ?? ""}`;

  if (!matchesSettingsQuery(searchableText, searchQuery)) return null;

  return (
    <article className="settings-item">
      <div>
        <b>{title}</b>
        <p>{description}</p>
        {example && <small>Пример: {example}</small>}
      </div>
      <div>{children}</div>
    </article>
  );
}
