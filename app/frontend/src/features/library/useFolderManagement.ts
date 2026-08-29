import {useEffect, useState} from "react";

import {reorder} from "../../lib/anime";
import {readLocal, writeLocal} from "../../lib/storage";
import type {Anime, Folder} from "../../lib/types";

const LAST_DELETED_FOLDER_KEY = "animesoul:last-deleted-folder";

type DeletedFolder = {
    folder: Folder;
    index: number;
};

type UseFolderManagementOptions = {
    folders: Folder[];
    saveFolders: (folders: Folder[]) => void;
};

/** Owns folder dialogs and all mutations of the user's folder collection. */
export function useFolderManagement({folders, saveFolders}: UseFolderManagementOptions) {
    const [folderPicker, setFolderPicker] = useState<Anime | null>(null);
    const [openedFolder, setOpenedFolder] = useState<Folder | null>(null);
    const [lastDeletedFolder, setLastDeletedFolder] = useState<DeletedFolder | null>(null);

    useEffect(() => setLastDeletedFolder(
        readLocal<DeletedFolder | null>(LAST_DELETED_FOLDER_KEY, null),
    ), []);

    const createFolder = () => {
        const name = prompt("Название новой папки")?.trim();
        if (!name) return;

        const folder = {id: crypto.randomUUID(), name, animeIds: []};
        saveFolders([...folders, folder]);
        return folder;
    };

    const toggleFolder = (folder: Folder, animeId: number) => {
        saveFolders(folders.map(item => item.id === folder.id ? {
            ...item,
            animeIds: item.animeIds.includes(animeId)
                ? item.animeIds.filter(id => id !== animeId)
                : [...item.animeIds, animeId],
        } : item));
    };

    const deleteFolder = (folder: Folder) => {
        if (!confirm(`Удалить папку «${folder.name}»? Её можно будет вернуть кнопкой отмены.`)) return;

        const deleted = {
            folder,
            index: Math.max(0, folders.findIndex(item => item.id === folder.id)),
        };
        setLastDeletedFolder(deleted);
        writeLocal(LAST_DELETED_FOLDER_KEY, deleted);
        saveFolders(folders.filter(item => item.id !== folder.id));
        if (openedFolder?.id === folder.id) setOpenedFolder(null);
    };

    const restoreLastFolder = () => {
        if (!lastDeletedFolder || folders.some(folder => folder.id === lastDeletedFolder.folder.id)) return;

        const next = [...folders];
        next.splice(Math.min(lastDeletedFolder.index, next.length), 0, lastDeletedFolder.folder);
        saveFolders(next);
        setLastDeletedFolder(null);
        localStorage.removeItem(LAST_DELETED_FOLDER_KEY);
    };

    const removeFromFolder = (folderId: string, animeId: number) => {
        saveFolders(folders.map(folder => folder.id === folderId ? {
            ...folder,
            animeIds: folder.animeIds.filter(id => id !== animeId),
        } : folder));
    };

    const currentFolder = openedFolder
        ? folders.find(folder => folder.id === openedFolder.id) ?? openedFolder
        : null;

    const updateFolderNote = (animeId: number, note: string) => {
        if (!openedFolder) return;
        saveFolders(folders.map(folder => folder.id === openedFolder.id ? {
            ...folder,
            notes: {...(folder.notes ?? {}), [animeId]: note},
        } : folder));
    };

    const reorderFolderAnime = (from: number, to: number) => {
        if (!openedFolder) return;
        saveFolders(folders.map(folder => folder.id === openedFolder.id
            ? {...folder, animeIds: reorder(folder.animeIds, from, to)}
            : folder));
    };

    const confirmFolderDeletion = () => {
        if (openedFolder) deleteFolder(openedFolder);
    };

    return {
        confirmFolderDeletion,
        createFolder,
        currentFolder,
        deleteFolder,
        folderPicker,
        lastDeletedFolder,
        removeFromFolder,
        reorderFolderAnime,
        restoreLastFolder,
        setFolderPicker,
        setOpenedFolder,
        toggleFolder,
        updateFolderNote,
    };
}
