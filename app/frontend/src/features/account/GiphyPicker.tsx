import { useEffect, useState } from "react";
import { useAccount } from "./context";
import { giphyReference, searchGiphy, type GiphyItem } from "./profileMedia";
import { ProfileIcon } from "./ProfileIcon";

export function GiphyPicker({ target, onSelect, onClose }: { target: "avatar" | "banner"; onSelect: (value: string) => void; onClose: () => void }) {
  const { config } = useAccount();
  const defaultQuery = target === "banner" ? "anime scenery" : "anime icon";
  const [query, setQuery] = useState(defaultQuery);
  const [search, setSearch] = useState({ query: defaultQuery, offset: 0, version: 0 });
  const [items, setItems] = useState<GiphyItem[]>([]);
  const [next, setNext] = useState(0);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = config.giphyKey;
  useEffect(() => {
    if (!key) return;
    let active = true;
    const controller = new AbortController();
    setBusy(true); setError("");
    if (!search.offset) setItems([]);
    void searchGiphy(key, search.query, search.offset, controller.signal).then(result => {
      if (!active) return;
      setItems(previous => search.offset ? [...previous, ...result.items] : result.items); setNext(result.nextOffset); setTotal(result.total);
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Поиск GIF недоступен"); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [key, search]);
  function find(value = query) { setQuery(value); setSearch(previous => ({ query: value.trim(), offset: 0, version: previous.version + 1 })); }
  return <section className="profile-gif-picker" aria-label={`Поиск GIF для ${target === "avatar" ? "аватарки" : "шапки"}`}>
    <div className="profile-gif-heading"><div><h3>{target === "avatar" ? "GIF для аватарки" : "GIF для шапки"}</h3><img className="profile-giphy-attribution" src="/giphy-attribution.png" alt="Powered by GIPHY" /></div><button type="button" className="profile-icon-button" aria-label="Закрыть поиск GIF" onClick={onClose}><ProfileIcon name="close" /></button></div>
    {!key ? <p className="profile-hint">Поиск GIF скоро появится. Пока можно выбрать готовый вариант или загрузить свой файл.</p> : <>
      <div className="profile-gif-search"><input aria-label="Поиск GIF" value={query} maxLength={50} placeholder="Аниме, персонаж или настроение" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); find(); } }} /><button type="button" className="profile-secondary" onClick={() => find()}>Найти</button></div>
      <div className="profile-gif-tags">{["anime", "anime scenery", "anime icon", "Frieren", "Naruto", ""].map(tag => <button type="button" key={tag} onClick={() => find(tag)} aria-pressed={search.query === tag}>{tag || "Популярное"}</button>)}</div>
      <div className="profile-gif-results" aria-busy={busy}>{items.map(item => <button type="button" key={item.id} aria-label={`Выбрать ${item.title}`} onClick={() => onSelect(giphyReference(item.id))}><img src={item.preview} alt={item.title} loading="lazy" referrerPolicy="no-referrer" /><span>Выбрать <ProfileIcon name="arrow" /></span></button>)}</div>
      <div className="profile-gif-status" aria-live="polite">{busy && <p className="profile-hint" role="status">Ищем GIF…</p>}{error && <p className="profile-error" role="alert">{error} <button type="button" className="profile-text" onClick={() => setSearch(previous => ({ ...previous, version: previous.version + 1 }))}>Повторить</button></p>}{!busy && !error && !items.length && <p className="profile-hint">Ничего не найдено. Попробуйте имя персонажа или название аниме.</p>}</div>
      {!busy && !error && next < total && !!items.length && <button type="button" className="profile-text" onClick={() => setSearch(previous => ({ ...previous, offset: next }))}>Показать ещё <ProfileIcon name="arrow" /></button>}
    </>}
  </section>;
}
