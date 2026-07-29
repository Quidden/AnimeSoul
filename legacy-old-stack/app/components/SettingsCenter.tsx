"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ConfigProfile, PlayerPrefs, Theme, ToolbarPosition } from "../lib/types";
import { DEFAULT_PLAYER_PREFS, STORAGE_KEYS as K, THEMES } from "../lib/settings";
import { readLocal as read, writeLocal as write } from "../lib/storage";
import { Toggle } from "./Toggle";

type Props = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  playerPrefs: PlayerPrefs;
  setPlayerPrefs: (prefs: PlayerPrefs) => void;
  historyEnabled: boolean;
  onHistoryEnabledChange: (enabled: boolean) => void;
  profiles: ConfigProfile[];
  activeProfile: string;
  onSwitchProfile?: (id: string) => void;
  onExport?: () => void;
  onImport?: (file: File) => void;
};

function Setting({ title, description, example, children }: { title: string; description: string; example?: string; children: ReactNode }) {
  return <article className="settings-item">
    <div><b>{title}</b><p>{description}</p>{example && <small>Пример: {example}</small>}</div>
    <div>{children}</div>
  </article>;
}

export function SettingsCenter(props: Props) {
  const [open, setOpen] = useState(false);
  const [toolbar, setToolbarState] = useState<ToolbarPosition>(read(K.toolbar, "bottom"));
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !modalRef.current?.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", close);
    document.addEventListener("pointerdown", closeOutside, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", closeOutside, true);
    };
  }, [open]);
  const setPrefs = (partial: Partial<PlayerPrefs>) => {
    const next = { ...DEFAULT_PLAYER_PREFS, ...props.playerPrefs, ...partial };
    props.setPlayerPrefs(next);
    write(K.playerPrefs, next);
    window.dispatchEvent(new CustomEvent("animesoul:player-prefs", { detail: next }));
  };
  const setToolbar = (value: ToolbarPosition) => {
    setToolbarState(value);
    write(K.toolbar, value);
    window.dispatchEvent(new CustomEvent("animesoul:toolbar", { detail: value }));
  };
  const resetSettings = () => {
    if (!confirm("Сбросить оформление и настройки просмотра? Прогресс, папки, избранное и отслеживания останутся без изменений.")) return;
    const nextPrefs = { ...DEFAULT_PLAYER_PREFS };
    props.setPlayerPrefs(nextPrefs);
    props.setTheme(THEMES[0]);
    setToolbarState("bottom");
    write(K.playerPrefs, nextPrefs);
    write(K.theme, THEMES[0]);
    write(K.toolbar, "bottom");
    window.dispatchEvent(new CustomEvent("animesoul:player-prefs", { detail: nextPrefs }));
    window.dispatchEvent(new CustomEvent("animesoul:toolbar", { detail: "bottom" }));
  };

  return <>
    <button className="settings-center-trigger" title="Открыть все настройки AnimeSoul" onClick={() => setOpen(true)}>⚙</button>
    {open && typeof document !== "undefined" && createPortal(<div
      className="settings-modal-backdrop"
      onPointerDown={event => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }}
      onClick={event => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <section ref={modalRef} className="settings-modal" role="dialog" aria-modal="true" aria-label="Настройки AnimeSoul">
        <header><div><span>ЦЕНТР УПРАВЛЕНИЯ</span><h2>Настройки AnimeSoul</h2><p>Все параметры сохраняются в активном профиле автоматически.</p></div><div className="settings-header-actions"><button className="settings-reset" onClick={resetSettings}>↺ Сбросить</button><button onClick={() => setOpen(false)} aria-label="Закрыть">×</button></div></header>
        <div className="settings-scroll">
          <aside className="settings-known-issues">
            <b>Возможные ограничения источников</b>
            <p>Часть функций зависит от данных API и видеоплеера. У некоторых аниме или серий могут отсутствовать кадры, точные таймкоды опенинга и эндинга, отдельные озвучки либо подтверждённая дата следующей серии. Кадры иногда бывают низкого качества, повторяются или не полностью соответствуют серии — AnimeSoul показывает только то, что вернул источник.</p>
          </aside>
          <section className="settings-group"><div className="settings-group-title"><b>Просмотр и продолжение</b><span>Поведение сайта при открытии и переключении серий</span></div>
            <Setting title="Автозапуск продолжения" description="После нажатия «Продолжить» плеер сам запускает серию с сохранённого момента." example="Остановились на 12:40 — серия откроется и начнёт играть с 12:40."><Toggle label="Включён" value={props.playerPrefs.autoPlayResume} onChange={value => setPrefs({ autoPlayResume: value })} /></Setting>
            <Setting title="Предпросмотр на главной" description="Показывает визуальный предпросмотр последней серии вместо обычной кнопки продолжения." example="На главной появится широкая карточка текущей серии."><Toggle label="Включён" value={props.playerPrefs.homeEpisodePreview} onChange={value => setPrefs({ homeEpisodePreview: value })} /></Setting>
            <Setting title="Источник предпросмотра" description="HD-картинка использует постер, а кадры серии — беззвучный видеопредпросмотр, если его отдаёт источник. Не для всех серий доступны кадры; иногда они имеют низкое качество, повторяются или относятся не к той части тайтла." example="Для стабильного качества и экономии трафика выбери HD-картинку."><div className="settings-segmented"><button disabled={!props.playerPrefs.homeEpisodePreview} className={props.playerPrefs.homePreviewMode === "poster" ? "active" : ""} onClick={() => setPrefs({ homePreviewMode: "poster" })}>HD-картинка</button><button disabled={!props.playerPrefs.homeEpisodePreview} className={props.playerPrefs.homePreviewMode === "screenshots" ? "active" : ""} onClick={() => setPrefs({ homePreviewMode: "screenshots" })}>Кадры серии</button></div></Setting>
            <Setting title="Переход к плееру" description="При ручном выборе серии страница плавно прокручивается к плееру. Автопереключение экран не двигает." example="Нажатие на серию 8 сразу покажет плеер."><Toggle label="Включён" value={props.playerPrefs.autoScrollPlayer} onChange={value => setPrefs({ autoScrollPlayer: value })} /></Setting>
          </section>

          <section className="settings-group"><div className="settings-group-title"><b>Плеер</b><span>Автоматизация и расположение элементов просмотра</span></div>
            <Setting title="Автоскип опенинга" description="Автоматически перематывает опенинг, когда источник передал точный таймкод. Если таймкод отсутствует или ошибочен, кнопка и автопропуск могут быть недоступны." example="Плеер перескочит с 0:45 на 2:15."><Toggle label="Включён" value={props.playerPrefs.autoSkipOpening} onChange={value => setPrefs({ autoSkipOpening: value })} /></Setting>
            <Setting title="Автоскип эндинга" description="Отмечает серию просмотренной и перематывает эндинг по таймкоду источника. Для серий без корректного таймкода завершение определяется по общей длительности." example="На 22:40 плеер перейдёт к концу серии."><Toggle label="Включён" value={props.playerPrefs.autoSkipEnding} onChange={value => setPrefs({ autoSkipEnding: value })} /></Setting>
            <Setting title="Автосерия" description="После завершения текущей серии автоматически открывает и запускает следующую." example="После серии 4 сразу начнётся серия 5."><Toggle label="Включён" value={props.playerPrefs.autoNext} onChange={value => setPrefs({ autoNext: value })} /></Setting>
            <Setting title="Карусель серий" description="Показывает предыдущую и следующую серии по бокам плеера для быстрого переключения." example="Нажми на правую карточку, чтобы перейти к следующей серии."><Toggle label="Включена" value={props.playerPrefs.playerEpisodeCarousel} onChange={value => setPrefs({ playerEpisodeCarousel: value })} /></Setting>
            <Setting title="Миниатюры при наведении" description="Через полсекунды показывает доступные кадры конкретной серии над её карточкой. Если API не вернул уникальные кадры этой серии, миниатюра не показывается; это предотвращает подмену кадрами другого сезона." example="Наведи курсор на серию 3, чтобы увидеть её кадры."><Toggle label="Включены" value={props.playerPrefs.episodeHoverPreview} onChange={value => setPrefs({ episodeHoverPreview: value })} /></Setting>
            <Setting title="Панель управления" description="Определяет, с какой стороны плеера располагаются озвучка, серия, источник и настройки." example="На широком мониторе удобно расположение справа."><select value={toolbar} onChange={event => setToolbar(event.target.value as ToolbarPosition)}><option value="bottom">Снизу</option><option value="top">Сверху</option><option value="left">Слева</option><option value="right">Справа</option></select></Setting>
          </section>

          <section className="settings-group"><div className="settings-group-title"><b>История</b><span>Отдельная лента недавних просмотров</span></div>
            <Setting title="Сохранять историю" description="Добавляет просмотренные серии в раздел истории. Прогресс просмотра сохраняется независимо от этой настройки." example="Можно отключить историю, не потеряв момент остановки."><Toggle label="Включена" value={props.historyEnabled} onChange={props.onHistoryEnabledChange} /></Setting>
          </section>

          <section className="settings-group"><div className="settings-group-title"><b>Оформление</b><span>Готовые темы и собственные цвета</span></div>
            <Setting title="Собственная палитра" description="Основной цвет меняет фон интерфейса, акцентный — кнопки, индикаторы и выделения."><div className="settings-colors"><label>Фон<input type="color" value={props.theme.background} onChange={event => props.setTheme({ ...props.theme, name: "Своя", background: event.target.value })} /></label><label>Акцент<input type="color" value={props.theme.accent} onChange={event => props.setTheme({ ...props.theme, name: "Своя", accent: event.target.value })} /></label></div></Setting>
            <Setting title="Готовые темы" description="Мгновенно применяет заранее подобранную пару основного и акцентного цветов."><div className="settings-themes">{THEMES.map(theme => <button key={theme.name} className={props.theme.name === theme.name ? "active" : ""} onClick={() => props.setTheme(theme)}><i style={{ background: `linear-gradient(135deg,${theme.background} 50%,${theme.accent} 50%)` }} />{theme.name}</button>)}</div></Setting>
          </section>

          <section className="settings-group"><div className="settings-group-title"><b>Профили и перенос данных</b><span>Папки, прогресс, отслеживание, темы и настройки</span></div>
            <Setting title="Активный профиль" description="Переключает полностью независимый набор сохранений и настроек." example="Создай отдельные профили для себя и друга."><select value={props.activeProfile} onChange={event => props.onSwitchProfile?.(event.target.value)}><option value="default">Основной</option>{props.profiles.filter(profile => profile.id !== "default").map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Setting>
            <Setting title="Резервная копия профиля" description="Выгрузка сохраняет профиль в JSON-файл, загрузка создаёт из выбранного файла новый профиль." example="Перенеси JSON на другой ПК и загрузи его здесь."><div className="settings-profile-actions"><button onClick={props.onExport}>⇩ Выгрузить профиль</button><label>⇧ Загрузить профиль<input type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) props.onImport?.(file); event.currentTarget.value = ""; }} /></label></div></Setting>
          </section>
          <section className="settings-group"><div className="settings-group-title"><b>Персонализация интерфейса</b><span>Размеры элементов и цвет просмотренных серий</span></div>
            <Setting title="Цвет просмотренной серии" description="Меняет рамку, фон и номер серии, которая уже была просмотрена.">
              <div className="settings-color-value"><input type="color" value={props.playerPrefs.watchedEpisodeColor} onChange={event => setPrefs({ watchedEpisodeColor: event.target.value })} /><code>{props.playerPrefs.watchedEpisodeColor}</code></div>
            </Setting>
            <Setting title="Размер обычного текста" description="Масштабирует подписи карточек, метаданные, кнопки и вспомогательный текст.">
              <label className="settings-range"><input type="range" min="85" max="125" step="5" value={Math.round(props.playerPrefs.interfaceFontScale * 100)} onChange={event => setPrefs({ interfaceFontScale: Number(event.target.value) / 100 })} /><b>{Math.round(props.playerPrefs.interfaceFontScale * 100)}%</b></label>
            </Setting>
            <Setting title="Размер заголовков" description="Отдельно изменяет крупные названия страниц, аниме и разделов.">
              <label className="settings-range"><input type="range" min="80" max="125" step="5" value={Math.round(props.playerPrefs.headingFontScale * 100)} onChange={event => setPrefs({ headingFontScale: Number(event.target.value) / 100 })} /><b>{Math.round(props.playerPrefs.headingFontScale * 100)}%</b></label>
            </Setting>
            <Setting title="Размер обложек" description="Меняет высоту постеров в каталоге, не нарушая сетку карточек.">
              <label className="settings-range"><input type="range" min="80" max="130" step="5" value={Math.round(props.playerPrefs.posterScale * 100)} onChange={event => setPrefs({ posterScale: Number(event.target.value) / 100 })} /><b>{Math.round(props.playerPrefs.posterScale * 100)}%</b></label>
            </Setting>
            <Setting title="Размер предпросмотра" description="Меняет карточку продолжения просмотра на главной странице.">
              <label className="settings-range"><input type="range" min="80" max="130" step="5" value={Math.round(props.playerPrefs.previewScale * 100)} onChange={event => setPrefs({ previewScale: Number(event.target.value) / 100 })} /><b>{Math.round(props.playerPrefs.previewScale * 100)}%</b></label>
            </Setting>
          </section>
          <section className="settings-group"><div className="settings-group-title"><b>Совместный просмотр</b><span>Комнаты через Hamachi, Tailscale или домашнюю сеть</span></div>
            <Setting title="Разрешить совместный режим" description="Добавляет в настройки плеера создание комнаты, подключение по коду и список участников. Видео загружается отдельно у каждого человека.">
              <Toggle label="Включён" value={props.playerPrefs.watchPartyEnabled} onChange={value => setPrefs({ watchPartyEnabled: value })} />
            </Setting>
            <Setting title="Имя участника" description="Это имя увидят остальные люди в комнате.">
              <input className="settings-text-input" value={props.playerPrefs.watchPartyName} maxLength={32} onChange={event => setPrefs({ watchPartyName: event.target.value })} />
            </Setting>
            <Setting title="Адрес комнаты" description="Хост оставляет локальный адрес. Участник вводит IP компьютера хоста в Hamachi или Tailscale и порт 3002." example="http://25.10.20.30:3002">
              <input className="settings-text-input" value={props.playerPrefs.watchPartyServer} onChange={event => setPrefs({ watchPartyServer: event.target.value })} />
            </Setting>
            <Setting title="Правило комнаты" description="Выбирается хостом. В первом режиме только хост управляет синхронизированными участниками. Во втором любой синхронизированный участник может поставить паузу, запустить, перемотать или сменить серию у всех." example="Перед началом просмотра хост выбирает: «Все следуют за хостом» или «Все управляют на равных».">
              <select value={props.playerPrefs.watchPartyRoomMode} onChange={event => setPrefs({ watchPartyRoomMode: event.target.value as "host" | "shared" })}><option value="host">Все следуют за хостом</option><option value="shared">Все управляют на равных</option></select>
            </Setting>
            <Setting title="Мой личный режим" description="Синхронизированный режим подчиняется правилу комнаты. Свободный просмотр доступен каждому участнику в любой момент и временно отделяет только его плеер от общих команд." example="При медленном интернете включи свободный режим, дождись загрузки и затем нажми «Перейти к общему таймкоду».">
              <select value={props.playerPrefs.watchPartyMode} onChange={event => setPrefs({ watchPartyMode: event.target.value as "follow" | "free" })}><option value="follow">Следовать за хостом</option><option value="free">Свободный просмотр / Режим медленного интернета</option></select>
            </Setting>
            <Setting title="Озвучка в комнате" description="Своя озвучка не меняется. Режим предложения показывает выбор при смене озвучки хостом. Полное следование переключает её автоматически, если такая озвучка доступна у участника." example="Хост выбрал AniLibria — можно переключиться одним нажатием или оставить свою озвучку.">
              <select value={props.playerPrefs.watchPartyDubMode} onChange={event => setPrefs({ watchPartyDubMode: event.target.value as "own" | "suggest" | "follow" })}><option value="own">Своя у каждого</option><option value="suggest">Предлагать озвучку хоста</option><option value="follow">Следовать за озвучкой хоста</option></select>
            </Setting>
            <Setting title="Автоматически догонять хоста" description="При расхождении больше пяти секунд плеер перематывается на позицию хоста. При выключении доступна ручная кнопка «Догнать».">
              <Toggle label="Включено" value={props.playerPrefs.watchPartyAutoCatchUp} onChange={value => setPrefs({ watchPartyAutoCatchUp: value })} />
            </Setting>
            <Setting title="Положение участников" description="Определяет, где рядом с плеером показывается состояние комнаты.">
              <select value={props.playerPrefs.watchPartyPanelPosition} onChange={event => setPrefs({ watchPartyPanelPosition: event.target.value as "top" | "bottom" | "overlay" })}><option value="top">Над плеером</option><option value="bottom">Под плеером</option><option value="overlay">Поверх плеера</option></select>
            </Setting>
            <details className="watch-party-guide">
              <summary><span><b>Как запустить совместный просмотр</b><small>Инструкция для хоста и участников · решение проблем</small></span><i>⌄</i></summary>
              <div className="watch-party-guide-content">
                <section>
                  <h3>Что понадобится</h3>
                  <ol>
                    <li>У каждого участника должна быть установлена и запущена AnimeSoul.</li>
                    <li>Все должны находиться в одной виртуальной сети либо в одной домашней сети. Скачать: <a href="https://vpn.net/" target="_blank" rel="noreferrer">Hamachi</a> или <a href="https://tailscale.com/download/windows" target="_blank" rel="noreferrer">Tailscale</a>.</li>
                    <li>На компьютере хоста локальный сервер AnimeSoul должен быть доступен на порту <code>3002</code>.</li>
                    <li>Одинаковые файлы сохранений не нужны: видео и прогресс у каждого загружаются независимо.</li>
                  </ol>
                </section>
                <section>
                  <h3>Хост: создание комнаты</h3>
                  <ol>
                    <li>Запусти AnimeSoul через штатный BAT-файл или десктопное приложение.</li>
                    <li>Оставь адрес комнаты <code>http://127.0.0.1:3002</code>.</li>
                    <li>Открой нужное аниме, включи «Совместный режим» в настройках плеера.</li>
                    <li>Выбери правило комнаты: управление только хостом или равноправное управление.</li>
                    <li>Нажми «Создать комнату» и отправь появившийся код друзьям.</li>
                    <li>При необходимости роль хоста можно передать любому подключённому участнику прямо в списке комнаты.</li>
                  </ol>
                </section>
                <section>
                  <h3>Участник: подключение</h3>
                  <ol>
                    <li>Узнай виртуальный IP хоста в Hamachi/Tailscale, например <code>25.10.20.30</code>.</li>
                    <li>В поле «Адрес комнаты» укажи <code>http://25.10.20.30:3002</code>.</li>
                    <li>Открой то же аниме, включи совместный режим и введи полученный код комнаты.</li>
                    <li>Выбери личный режим. «Свободный просмотр / Режим медленного интернета» доступен всегда, независимо от правила комнаты.</li>
                  </ol>
                </section>
                <section>
                  <h3>Как работают режимы</h3>
                  <dl>
                    <div><dt>Все следуют за хостом</dt><dd>Только хост управляет общим запуском, паузой, серией и таймкодом. Остальные синхронизированные участники повторяют его действия.</dd></div>
                    <div><dt>Все управляют на равных</dt><dd>Любой участник в синхронизированном режиме может поставить видео на паузу, продолжить, перемотать или выбрать серию — команда применяется у всех синхронизированных участников.</dd></div>
                    <div><dt>Свободный просмотр / медленный интернет</dt><dd>Это не правило комнаты, а личный режим. Он доступен всем, включая хоста, в любой момент. Общие команды не двигают твой плеер, а твои действия не мешают остальным. Таймкоды участников остаются видны, вернуться можно кнопкой «Перейти к общему таймкоду».</dd></div>
                    <div><dt>Передача хоста</dt><dd>Текущий хост нажимает «Передать хоста» рядом с именем участника. Новый хост сразу получает право менять правило комнаты; при выходе хоста роль автоматически передаётся одному из оставшихся участников.</dd></div>
                    <div><dt>Своя озвучка</dt><dd>У каждого остаётся выбранная им озвучка. Серия синхронизируется, но голосовая дорожка не меняется.</dd></div>
                    <div><dt>Предлагать озвучку хоста</dt><dd>При смене озвучки появляется предложение «Переключиться» или «Оставить мою». Без подтверждения AnimeSoul ничего не меняет.</dd></div>
                    <div><dt>Следовать за озвучкой хоста</dt><dd>Озвучка меняется автоматически, если она доступна для этой серии. При отсутствии AnimeSoul оставляет доступную локальную озвучку и показывает предупреждение.</dd></div>
                  </dl>
                </section>
                <section>
                  <h3>Совместимость видеоплееров</h3>
                  <dl>
                    <div><dt>Kodik</dt><dd>Поддерживает полную синхронизацию AnimeSoul: серия, озвучка, запуск, пауза, перемотка и точный таймкод.</dd></div>
                    <div><dt>Другие источники</dt><dd>Выбор серии и озвучки синхронизируется нашей оболочкой. Пауза, запуск, перемотка и точный таймкод работают только тогда, когда встроенный плеер отдаёт совместимые события управления.</dd></div>
                    <div><dt>Почему у участников может быть разный результат</dt><dd>Набор озвучек и источников иногда отличается между сериями. Для предсказуемого совместного просмотра всем участникам рекомендуется выбрать Kodik.</dd></div>
                  </dl>
                </section>
                <section className="watch-party-troubleshooting">
                  <h3>Проблемы и решения</h3>
                  <dl>
                    <div><dt>«Сервер комнаты недоступен» или Not found</dt><dd>Полностью перезапусти AnimeSoul. Убедись, что адрес заканчивается на <code>:3002</code>, а не на порт сайта <code>:3001</code>.</dd></div>
                    <div><dt>Друг не подключается</dt><dd>Проверь, что вы видите друг друга в Hamachi/Tailscale. Разреши Node.js/AnimeSoul в брандмауэре Windows для частных сетей и открой TCP-порт 3002.</dd></div>
                    <div><dt>Высокий пинг</dt><dd>Переключись в свободный режим. Пинг комнаты показан в верхнем баре; он относится к командам синхронизации, а не к скорости загрузки видео.</dd></div>
                    <div><dt>Видео у друга загружается медленнее</dt><dd>Это не останавливает остальных: каждый получает видео от источника отдельно. Используй свободный режим или кнопку «Догнать хоста» после загрузки.</dd></div>
                    <div><dt>Открылась не та серия или озвучка</dt><dd>Откройте одну франшизу и убедитесь, что нужная озвучка доступна у обоих. Некоторые источники имеют разный набор серий и озвучек.</dd></div>
                    <div><dt>Пауза или перемотка не повторяется</dt><dd>Проверь, что у всех выбран плеер Kodik. Для остальных источников точное управление временем может быть недоступно — при необходимости используй свободный режим и кнопку «Догнать хоста».</dd></div>
                    <div><dt>Комната исчезла</dt><dd>Комнаты временные и хранятся в памяти компьютера хоста. После его перезапуска нужно создать новую комнату и отправить новый код.</dd></div>
                  </dl>
                </section>
              </div>
            </details>
          </section>
        </div>
      </section>
    </div>, document.body)}
  </>;
}
