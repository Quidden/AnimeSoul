const HOME_CARD_PAGE_SIZE = 10;

export function HomeLoadMore({ remaining, onLoadMore }: { remaining: number; onLoadMore: () => void }) {
  if (remaining <= 0) return null;

  return (
    <div className="home-load-more">
      <button
        type="button"
        className="home-action-button"
        onClick={onLoadMore}
        aria-label={`Загрузить ещё карточки. Осталось ${remaining}`}
      >
        Загрузить ещё
        <span>{Math.min(HOME_CARD_PAGE_SIZE, remaining)}</span>
      </button>
    </div>
  );
}
