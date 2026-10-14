export const themeStorageKey = "animesoul:theme";
export const themeChoices = [
  { id: "lilac", label: "Лиловая", description: "Привычные фиолетовые акценты" },
  { id: "graphite", label: "Графит", description: "Нейтральные серо-синие акценты" },
] as const;
export type Theme = (typeof themeChoices)[number]["id"];

export function parseTheme(value: unknown): Theme | null {
  return value === "lilac" || value === "graphite" ? value : null;
}

// This trusted, synchronous head script runs before body content can be painted.
// It accepts only known values; storage denial leaves the server's default intact.
export const themeBootstrap = `(()=>{try{const theme=localStorage.getItem(${JSON.stringify(themeStorageKey)});if(theme==="lilac"||theme==="graphite")document.documentElement.setAttribute("data-theme",theme)}catch{}})();`;
