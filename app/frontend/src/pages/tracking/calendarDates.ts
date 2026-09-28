export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Six uninterrupted weeks, Monday first, including adjacent months. */
export function monthDays(month: Date): Date[] {
  const year = month.getFullYear();
  const index = month.getMonth();
  const offset = (new Date(year, index, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, cell) => new Date(year, index, cell - offset + 1, 12));
}
