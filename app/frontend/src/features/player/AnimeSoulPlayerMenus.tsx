export type PlayerMenuOption = {
    value: string;
    label: string;
    disabled?: boolean;
    warning?: string;
};

export type BurnedSubtitleOption = {
    value: string;
    label: string;
    request: import("../../lib/kodikStream").KodikStreamRequest;
};

export type VideoFit = "contain" | "cover" | "ambient";

export type PlayerMenu = {
    dubbings: PlayerMenuOption[];
    dubbing: string;
    onDubbingChange: (value: string) => void;
    dubbingFavorite: boolean;
    onDubbingFavoriteToggle: () => void;
    dubbingGloballyPreferred: boolean;
    onDubbingGloballyPreferredToggle: () => void;
    seasons: PlayerMenuOption[];
    season: string;
    onSeasonChange: (value: string) => void;
    episodes: PlayerMenuOption[];
    episode: string;
    onEpisodeChange: (value: string) => void;
    sources: PlayerMenuOption[];
    source: string;
    onSourceChange: (value: string) => void;
    subtitles: BurnedSubtitleOption[];
    autoSkipOpening: boolean;
    onAutoSkipOpeningChange: (value: boolean) => void;
    autoSkipEnding: boolean;
    onAutoSkipEndingChange: (value: boolean) => void;
    autoNext: boolean;
    onAutoNextChange: (value: boolean) => void;
    externalToolbarVisible: boolean;
    onExternalToolbarVisibleChange: (value: boolean) => void;
};

type PlayerSettingsPanelProps = {
    activeBitrate: string;
    activeDubbingOption?: PlayerMenuOption;
    activeQuality: number;
    episodeLabel: string;
    localPlayback: boolean;
    menu: PlayerMenu;
    onClose: () => void;
    onFallback?: () => void;
    onVideoFitChange: (fit: VideoFit) => void;
    quality: number;
    seasonLabel: string;
    videoFit: VideoFit;
};

export function PlayerSettingsPanel({
    activeBitrate,
    activeDubbingOption,
    activeQuality,
    episodeLabel,
    localPlayback,
    menu,
    onClose,
    onFallback,
    onVideoFitChange,
    quality,
    seasonLabel,
    videoFit,
}: PlayerSettingsPanelProps) {
    return (
        <aside
            className="animesoul-player-settings"
            aria-label="Настройки плеера"
            onClick={event => event.stopPropagation()}
        >
            <header>
                <div><strong>Настройки</strong><span>{seasonLabel} · {episodeLabel}</span></div>
                <button type="button" aria-label="Закрыть настройки" onClick={onClose}>×</button>
            </header>
            <div className="animesoul-player-settings-content">
                <label>
                    <span>Озвучка</span>
                    <select value={menu.dubbing} onChange={event => menu.onDubbingChange(event.target.value)}>
                        {menu.dubbings.map(option => (
                            <option key={option.value} value={option.value} disabled={option.disabled}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="animesoul-player-dubbing-actions">
                    <button
                        type="button"
                        className={menu.dubbingFavorite ? "active" : ""}
                        aria-pressed={menu.dubbingFavorite}
                        onClick={menu.onDubbingFavoriteToggle}
                    >★ <span>В избранном</span></button>
                    <button
                        type="button"
                        className={menu.dubbingGloballyPreferred ? "active title" : ""}
                        aria-pressed={menu.dubbingGloballyPreferred}
                        onClick={menu.onDubbingGloballyPreferredToggle}
                    >♥ <span>Любимая везде</span></button>
                </div>
                {activeDubbingOption?.warning && (
                    <div className="animesoul-player-duration-warning">
                        ⚠ {activeDubbingOption.warning}
                    </div>
                )}
                <MenuSelect
                    label="Сезон"
                    value={menu.season}
                    options={menu.seasons}
                    onChange={menu.onSeasonChange}
                />
                <MenuSelect
                    label="Серия"
                    value={menu.episode}
                    options={menu.episodes}
                    onChange={menu.onEpisodeChange}
                />
                <MenuSelect
                    label="Источник"
                    value={menu.source}
                    options={menu.sources}
                    onChange={menu.onSourceChange}
                />
                <label className="animesoul-player-fit-control">
                    <span>Отображение видео</span>
                    <select
                        value={videoFit}
                        onChange={event => onVideoFitChange(parseVideoFit(event.target.value))}
                    >
                        <option value="cover">Заполнить экран</option>
                        <option value="contain">Показывать целиком</option>
                        <option value="ambient">Погружение · динамический фон</option>
                    </select>
                </label>
                <div className="animesoul-player-stream-state">
                    <span>{localPlayback ? "Источник" : "Поток"}</span>
                    <strong>{localPlayback
                        ? `Локальный файл · ${activeQuality || quality}p`
                        : `${activeQuality || quality}p${activeBitrate ? ` · ${activeBitrate}` : ""}`}
                    </strong>
                </div>
                <div className="animesoul-player-automation-settings">
                    <span>Автоматизация</span>
                    <PlayerSettingToggle
                        label="Автоскип опенинга"
                        checked={menu.autoSkipOpening}
                        onChange={menu.onAutoSkipOpeningChange}
                    />
                    <PlayerSettingToggle
                        label="Автоскип эндинга"
                        checked={menu.autoSkipEnding}
                        onChange={menu.onAutoSkipEndingChange}
                    />
                    <PlayerSettingToggle
                        label="Автосерия"
                        checked={menu.autoNext}
                        onChange={menu.onAutoNextChange}
                    />
                </div>
                <label className="animesoul-player-toolbar-toggle">
                    <input
                        type="checkbox"
                        checked={menu.externalToolbarVisible}
                        onChange={event => menu.onExternalToolbarVisibleChange(event.target.checked)}
                    />
                    <span>Показывать внешнюю панель</span>
                </label>
                {onFallback && (
                    <button
                        type="button"
                        className="animesoul-player-kodik-fallback"
                        onClick={onFallback}
                    >Открыть обычный плеер Kodik</button>
                )}
            </div>
        </aside>
    );
}

type PlayerTopNavigationProps = {
    activeDubbingOption?: PlayerMenuOption;
    episodeLabel: string;
    menu: PlayerMenu;
    onToggleQuickPicker: () => void;
    quickPickerOpen: boolean;
    seasonLabel: string;
    title: string;
};

export function PlayerTopNavigation({
    activeDubbingOption,
    episodeLabel,
    menu,
    onToggleQuickPicker,
    quickPickerOpen,
    seasonLabel,
    title,
}: PlayerTopNavigationProps) {
    return (
        <>
            <div className="animesoul-player-top-navigation" onClick={event => event.stopPropagation()}>
                <button
                    type="button"
                    className="animesoul-player-context"
                    aria-label="Выбрать сезон и серию"
                    aria-expanded={quickPickerOpen}
                    onClick={onToggleQuickPicker}
                >
                    <span className="animesoul-player-context-copy">
                        <strong>{seasonLabel} · {episodeLabel}</strong>
                        <span>{title}</span>
                    </span>
                    <i aria-hidden="true">⌄</i>
                </button>
                <label
                    className={`animesoul-player-voice-pill${activeDubbingOption?.warning ? " warning" : ""}`}
                    title={activeDubbingOption?.warning || "Быстрый выбор озвучки"}
                >
                    <span>
                        Озвучка
                        {activeDubbingOption?.warning && <b>⚠ возможна сокращённая версия</b>}
                    </span>
                    <select
                        value={menu.dubbing}
                        aria-label="Озвучка"
                        onChange={event => menu.onDubbingChange(event.target.value)}
                    >
                        {menu.dubbings.map(option => (
                            <option key={option.value} value={option.value} disabled={option.disabled}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {quickPickerOpen && (
                <div
                    className="animesoul-player-quick-picker"
                    aria-label="Выбор сезона и серии"
                    onClick={event => event.stopPropagation()}
                >
                    <MenuSelect
                        label="Сезон"
                        value={menu.season}
                        options={menu.seasons}
                        onChange={menu.onSeasonChange}
                    />
                    <MenuSelect
                        label="Серия"
                        value={menu.episode}
                        options={menu.episodes}
                        onChange={menu.onEpisodeChange}
                    />
                </div>
            )}
        </>
    );
}

function MenuSelect({
    label,
    onChange,
    options,
    value,
}: {
    label: string;
    onChange: (value: string) => void;
    options: PlayerMenuOption[];
    value: string;
}) {
    return (
        <label>
            <span>{label}</span>
            <select value={value} onChange={event => onChange(event.target.value)}>
                {options.map(option => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
}

function PlayerSettingToggle({
    checked,
    label,
    onChange,
}: {
    checked: boolean;
    label: string;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="animesoul-player-setting-toggle">
            <span>{label}</span>
            <input
                type="checkbox"
                checked={checked}
                onChange={event => onChange(event.target.checked)}
            />
        </label>
    );
}

function parseVideoFit(value: string): VideoFit {
    if (value === "cover" || value === "ambient") return value;
    return "contain";
}
