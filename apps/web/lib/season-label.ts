// Season "0" holds specials; showing it as "Сезон 0" reads like a data error.
export function seasonLabel(season: string) {
  return season === "0" ? "Спецвыпуски" : `Сезон ${season}`;
}
