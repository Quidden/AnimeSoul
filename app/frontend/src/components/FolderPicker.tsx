import { useRef } from "react";
import { useModalAccessibility } from "../lib/modalAccessibility";
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(true, onClose, dialogRef);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <h2 id="folder-picker-title">Папки</h2>
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
          <button type="button" className="outline" onClick={onCreate}>＋ Новая папка</button>
          <button type="button" className="primary" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}
