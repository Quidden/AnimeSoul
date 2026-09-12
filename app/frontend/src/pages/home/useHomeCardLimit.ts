import { useState } from "react";

const HOME_CARD_PAGE_SIZE = 10;

export function useHomeCardLimit(total: number) {
  const [limit, setLimit] = useState(HOME_CARD_PAGE_SIZE);
  const visibleCount = Math.min(limit, total);

  return {
    visibleCount,
    remaining: Math.max(0, total - visibleCount),
    loadMore: () => setLimit(current => Math.min(current + HOME_CARD_PAGE_SIZE, total)),
  };
}
