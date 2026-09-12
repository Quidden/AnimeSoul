import {useRef} from "react";
import {ReleaseMark} from "../components/ReleaseMark";
import {formatTime, watchTimeProgress} from "../lib/anime";
import {useModalAccessibility} from "../lib/modalAccessibility";
import type {Anime, CardMeta, Folder, Progress} from "../lib/types";

export function FolderView({folder, known, progress, cardMeta, onOpen, onNote, onReorder, onDelete, onClose}: {
    folder: Folder;
    known: (id: number) => Anime | undefined;
    progress: Progress;
    cardMeta: Record<number, CardMeta>;
    onOpen: (a: Anime, resume?: boolean) => void;
    onNote: (id: number, note: string) => void;
    onReorder: (from: number, to: number) => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const dialogRef = useRef<HTMLDivElement>(null);
    useModalAccessibility(true, onClose, dialogRef);

    return <div className="modal-backdrop" onMouseDown={onClose}>
        <div ref={dialogRef} className="modal folder-view" role="dialog" aria-modal="true"
             aria-labelledby="folder-view-title" tabIndex={-1} onMouseDown={e => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
            <div className="folder-view-head">
                <div><span className="eyebrow">ПАПКА · ПЕРЕТАЩИ ДЛЯ СОРТИРОВКИ</span><h2 id="folder-view-title">{folder.name}</h2></div>
                <button type="button" className="danger outline" onClick={onDelete}>Удалить папку</button>
            </div>
            <div className="folder-anime-list">{folder.animeIds.map(id => {
                const a = known(id), p = progress[id],
                    state = p?.episodes[`${p.season ?? 1}:${p.episode}`] ?? Object.values(p?.episodes ?? {}).sort((x, y) => y.updatedAt - x.updatedAt)[0],
                    whole = watchTimeProgress(p);
                return <article draggable onDragStart={e => e.dataTransfer.setData("text/plain", String(id))}
                                onDragOver={e => e.preventDefault()} onDrop={e => {
                    e.preventDefault();
                    onReorder(Number(e.dataTransfer.getData("text/plain")), id);
                }} key={id}><span className="drag">⠿</span>{a?.poster?.big &&
                    <img className="folder-anime-link" src={a.poster.big} alt="" onClick={() => onOpen(a, false)}/>}
                    <div><h3 className={a ? "folder-anime-link" : ""}
                             onClick={() => a && onOpen(a, false)}>{a?.title ?? `Загружаем аниме #${id}…`}</h3>
                        <ReleaseMark anime={a} status={cardMeta[id]?.status}/><p>{p?.totalEpisodes ?? "—"} серий ·
                            сезон {p?.season ?? 1} · {whole}% всего</p>
                        <div className="wide-progress"><i style={{width: `${whole}%`}}/></div>
                        <textarea value={folder.notes?.[id] ?? ""} onChange={e => onNote(id, e.target.value)}
                                  placeholder="Своя заметка об аниме…"/></div>
                    <aside><small>Остановились: {formatTime(state?.position ?? 0)}</small>{a &&
                        <button className="primary" onClick={() => onOpen(a, true)}>▶ Продолжить</button>}</aside>
                </article>;
            })}{!folder.animeIds.length && <div className="empty">В этой папке пока нет аниме</div>}</div>
        </div>
    </div>;
}
