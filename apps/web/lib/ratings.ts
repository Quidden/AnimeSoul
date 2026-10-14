export function ratingNumber(value: number) {
  return value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}
