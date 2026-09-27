import { Brand } from "./Header";
import { APP_VERSION } from "../version";
import { IS_ANDROID_APP } from "../lib/platform";
import type { ApplicationView } from "../features/catalog/useCatalogController";
import { emitAppEvent } from "../lib/events";

/** Shared footer used by every top-level application view. */
export function AppFooter({activeView, onNavigate}: {activeView?: ApplicationView; onNavigate?: (view: ApplicationView) => void}) {
    const groups: {title: string; links: {label: string; path: string; view: ApplicationView}[]}[] = [
        {title: "Основное", links: [
            {label: "Главная", path: "/", view: "home"},
            {label: "Каталог", path: "/catalog", view: "catalog"},
            {label: "Скачанные", path: "/downloads", view: "downloads"},
            {label: "Статистика", path: "/statistics", view: "stats"},
            {label: "Отслеживание", path: "/tracking", view: "tracking"},
            {label: "Папки и избранное", path: "/library", view: "library"},
            {label: "История", path: "/history", view: "history"},
        ]},
        {title: "Навигация и аккаунт", links: [{label: "Оценки", path: "/ratings", view: "ratings"}]},
    ];
    return (
        <footer>
            <nav className="footer-sitemap" aria-label="Карта сайта">
                {groups.map(group => <div className="footer-sitemap-group" key={group.title}>
                    <h2>{group.title}</h2>
                    {group.links.map(link => <a key={link.path} href={link.path} aria-current={activeView === link.view ? "page" : undefined}
                        onClick={event => {
                            if (!onNavigate || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                            event.preventDefault();
                            onNavigate(link.view);
                        }}>{link.label}</a>)}
                    {group.title === "Навигация и аккаунт" && <button type="button" onClick={() => emitAppEvent("open-settings", {tab: "watching"})}>Настройки</button>}
                </div>)}
                <div className="footer-sitemap-group"><h2>Внешние ссылки</h2>
                    <a href="https://shikimori.one" target="_blank" rel="noopener noreferrer">Shikimori ↗</a>
                </div>
            </nav>
            <Brand />
            <span className="api-thanks">
                Огромная благодарность разработчикам YummyAnime за предоставленный API —
                только благодаря им был создан AnimeSoul.
            </span>
            <span>
                Прогресс и настройки сохраняются {IS_ANDROID_APP ? "на этом устройстве" : "на этом ПК"}
            </span>
            <span className="app-version">Версия {APP_VERSION}</span>
            <span className="anime4k-credit">
                Апскейл: <a href="https://github.com/bloc97/Anime4K" target="_blank" rel="noreferrer">Anime4K</a> · <a href="https://github.com/Anime4KWebBoost/Anime4K-WebGPU" target="_blank" rel="noreferrer">WebGPU-порт</a> · MIT License
            </span>
        </footer>
    );
}
