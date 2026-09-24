import type { Anime } from "../../lib/types";
import { lanRequest, type LanCommand, type LanPlayer } from "./api";
import { executeLanCommand } from "./executeLanCommand";

export function startLanControl(
  getBridge: () => { state: () => LanPlayer; command: (command: LanCommand) => void | Promise<void> } | null,
  getOptions: () => { catalog: Anime[]; openAnime: (anime: Anime, resume?: boolean) => void },
) {
  const controller = new AbortController();
  const executed = new Map<string, string>();
  let activity = false;
  let busy = false;
  const markActivity = (event: Event) => { if (event.isTrusted) activity = true; };
  document.addEventListener("pointerdown", markActivity, true);
  document.addEventListener("keydown", markActivity, true);
  const tick = async () => {
    if (busy) return;
    busy = true;
    const sentActivity = activity;
    activity = false;
    try {
      const result = await lanRequest<{ commands: LanCommand[]; localPriority: boolean }>("/poll", "POST", {
        player: getBridge()?.state() ?? {}, activity: sentActivity,
        acknowledgements: [...executed].slice(-20).map(([id, error]) => ({ id, error })),
      }, controller.signal);
      for (const command of result.commands) {
        if (controller.signal.aborted || executed.has(command.id)) continue;
        if (activity && result.localPriority) {
          executed.set(command.id, "Приоритет у локального управления.");
          continue;
        }
        executed.set(command.id, "");
        try { await executeLanCommand(command, getBridge, getOptions, controller.signal); }
        catch (error) { executed.set(command.id, error instanceof Error ? error.message : "Ошибка управления."); }
      }
      while (executed.size > 100) executed.delete(executed.keys().next().value!);
    } catch { activity ||= sentActivity; }
    finally { busy = false; }
  };
  const timer = window.setInterval(() => void tick(), 1_000);
  return () => {
    controller.abort(); window.clearInterval(timer);
    document.removeEventListener("pointerdown", markActivity, true);
    document.removeEventListener("keydown", markActivity, true);
  };
}
