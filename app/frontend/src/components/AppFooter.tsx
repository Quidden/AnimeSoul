import { Brand } from "./Header";
import { APP_VERSION } from "../version";
import { IS_ANDROID_APP } from "../lib/platform";

/** Shared footer used by every top-level application view. */
export function AppFooter() {
    return (
        <footer>
            <Brand />
            <span className="api-thanks">
                Огромная благодарность разработчикам YummyAnime за предоставленный API —
                только благодаря им был создан AnimeSoul.
            </span>
            <span>
                Прогресс и настройки сохраняются {IS_ANDROID_APP ? "на этом устройстве" : "на этом ПК"}
            </span>
            <span className="app-version">Версия {APP_VERSION}</span>
        </footer>
    );
}
