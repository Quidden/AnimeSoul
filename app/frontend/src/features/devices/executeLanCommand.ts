import type { Anime } from "../../lib/types";
import { fetchOfflineAnime } from "../../lib/downloads";
import { fetchAnimeDetails } from "../catalog/api";
import { emitAppEvent } from "../../lib/events";
import type { LanCommand, LanPlayer } from "./api";

type Bridge = { state: () => LanPlayer; command: (command: LanCommand) => void | Promise<void> };

export async function executeLanCommand(command: LanCommand, getBridge: () => Bridge | null,
  getOptions: () => { catalog: Anime[]; openAnime: (anime: Anime, resume?: boolean) => void }, signal: AbortSignal) {
  if (command.action === "open") {
    if (!command.animeId) throw Error("Не указан ID аниме.");
    const offline = await fetchOfflineAnime(command.animeId);
    let anime = getOptions().catalog.find(a => a.anime_id === command.animeId);
    if (offline) anime = { anime_id: offline.animeId, title: offline.title, year: offline.year,
      poster: offline.posterUrl ? { big: offline.posterUrl, fullsize: offline.posterUrl } : undefined };
    if (!anime) anime = (await fetchAnimeDetails([command.animeId]))[0];
    if (!anime) throw Error("Аниме не найдено на устройстве.");
    if (signal.aborted) return;
    getOptions().openAnime(anime, false);
    emitAppEvent("close-settings");
    const deadline = Date.now() + 7_000;
    while (Date.now() < deadline && !signal.aborted) {
      const bridge = getBridge();
      if (bridge?.state().animeId === command.animeId && bridge.state().episodes?.length) {
        await bridge.command({ ...command, action: "episode" });
        return;
      }
      await new Promise(resolve => window.setTimeout(resolve, 150));
    }
    throw Error("Серии ещё не загрузились. Повторите выбор серии.");
  }
  const bridge = getBridge();
  if (!bridge) throw Error("На устройстве не открыт плеер.");
  await bridge.command(command);
}
