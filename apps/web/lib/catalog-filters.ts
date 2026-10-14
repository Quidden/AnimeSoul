import { catalogQuerySchema, type CatalogQuery } from "@animesoul/contracts";
export const catalogSections = [
  { key: "popular", title: "Популярные", filters: { sort: "popular" } },
  { key: "ongoing", title: "Онгоинги", filters: { status: "ongoing", sort: "popular" } },
  { key: "new", title: "Новинки", filters: { sort: "newest" } },
  { key: "top", title: "С высокой оценкой", filters: { sort: "rating", minRating: "8" } },
  { key: "completed", title: "Завершённые", filters: { status: "released", sort: "rating" } },
  { key: "announced", title: "Анонсы", filters: { status: "announced", sort: "newest" } },
  { key: "movies", title: "Фильмы", filters: { format: "movie", sort: "rating" } },
  { key: "series", title: "Сериалы", filters: { format: "tv", sort: "popular" } },
  { key: "for-you", title: "Для меня", filters: { personalized: "1" } },
  { key: "all", title: "Все аниме", filters: {} },
] as const;
export const formatLabels: Record<string, string> = {
  unknown: "Аниме",
  tv: "TV-сериал",
  movie: "Фильм",
  ova: "OVA",
  ona: "ONA",
  special: "Спецвыпуск",
  music: "Клип",
};
export type CatalogSearch = Record<string, string | string[] | undefined>;
export function catalogFilters(
  search: CatalogSearch,
  defaults: Record<string, string> = {},
): CatalogQuery {
  const input: Record<string, string> = { ...defaults };
  for (const [key, value] of Object.entries(search))
    if (typeof value === "string") input[key] = value;
  for (const key of ["status", "format", "personalized"])
    if (defaults[key]) input[key] = defaults[key]!;
  if (defaults.minRating)
    input.minRating = String(Math.max(Number(defaults.minRating), Number(input.minRating) || 0));
  const parsed = catalogQuerySchema.safeParse(input);
  return parsed.success ? parsed.data : catalogQuerySchema.parse(defaults);
}
export function catalogParameters(filters: CatalogQuery) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== "" && key !== "pageSize") query.set(key, String(value));
  return query;
}
