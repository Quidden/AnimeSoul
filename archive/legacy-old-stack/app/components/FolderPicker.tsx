import type { Anime, Folder } from "../lib/types";

export function FolderPicker({
  anime,
  folders,
  onToggle,
  onCreate,
  onClose,
}: {
  anime: Anime;
  folders: Folder[];
  onToggle: (folder: Folder, id: number) => void;
  onCreate: () => unknown;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>Папки</h2>
        <p>Куда добавить «{anime.title}»?</p>
        <div className="folder-checks">
          {folders.map((folder) => (
            <label key={folder.id}>
              <input
                type="checkbox"
                checked={folder.animeIds.includes(anime.anime_id)}
                onChange={() => onToggle(folder, anime.anime_id)}
              />
              <span>{folder.name}</span>
              <b>{folder.animeIds.includes(anime.anime_id) ? "Добавлено" : "Добавить"}</b>
            </label>
          ))}
          {!folders.length && <p>Сначала создай папку — например, «Смотреть вечером».</p>}
        </div>
        <div className="modal-actions">
          <button className="outline" onClick={onCreate}>＋ Новая папка</button>
          <button className="primary" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}
