import type { PlayerPrefs, ToolbarPosition } from "../../lib/types";
import { Toggle } from "../../components/Toggle";
import { Setting } from "./Setting";

type Props = {
  playerPrefs: PlayerPrefs;
  toolbar: ToolbarPosition;
  historyEnabled: boolean;
  updatePlayerPrefs: (partial: Partial<PlayerPrefs>) => void;
  updateToolbar: (value: ToolbarPosition) => void;
  onHistoryEnabledChange: (enabled: boolean) => void;
};

export function PlaybackSettings({
  playerPrefs,
  toolbar,
  historyEnabled,
  updatePlayerPrefs,
  updateToolbar,
  onHistoryEnabledChange,
}: Props) {
  return (
    <>
      <aside className="settings-known-issues" data-settings-tab="player">
        <b>Возможные ограничения источников</b>
        <p>
          Часть функций зависит от данных API и видеоплеера. У некоторых аниме или серий могут
          отсутствовать кадры, точные таймкоды опенинга и эндинга, отдельные озвучки либо
          подтверждённая дата следующей серии. Кадры иногда бывают низкого качества, повторяются
          или не полностью соответствуют серии — AnimeSoul показывает только то, что вернул источник.
        </p>
      </aside>

      <section className="settings-group" data-settings-tab="watching">
        <div className="settings-group-title">
          <b>Просмотр и продолжение</b>
          <span>Поведение сайта при открытии и переключении серий</span>
        </div>
        <Setting
          title="Автозапуск продолжения"
          description="После нажатия «Продолжить» плеер сам запускает серию с сохранённого момента."
          example="Остановились на 12:40 — серия откроется и начнёт играть с 12:40."
        >
          <Toggle
            label="Включён"
            value={playerPrefs.autoPlayResume}
            onChange={(value) => updatePlayerPrefs({ autoPlayResume: value })}
          />
        </Setting>
        <Setting
          title="Предпросмотр на главной"
          description="Показывает визуальный предпросмотр последней серии вместо обычной кнопки продолжения."
          example="На главной появится широкая карточка текущей серии."
        >
          <Toggle
            label="Включён"
            value={playerPrefs.homeEpisodePreview}
            onChange={(value) => updatePlayerPrefs({ homeEpisodePreview: value })}
          />
        </Setting>
        <Setting
          title="Источник предпросмотра"
          description="HD-картинка использует постер, а кадры серии — беззвучный видеопредпросмотр, если его отдаёт источник. Не для всех серий доступны кадры; иногда они имеют низкое качество, повторяются или относятся не к той части тайтла."
          example="Для стабильного качества и экономии трафика выбери HD-картинку."
        >
          <div className="settings-segmented">
            <button
              disabled={!playerPrefs.homeEpisodePreview}
              className={playerPrefs.homePreviewMode === "poster" ? "active" : ""}
              onClick={() => updatePlayerPrefs({ homePreviewMode: "poster" })}
            >
              HD-картинка
            </button>
            <button
              disabled={!playerPrefs.homeEpisodePreview}
              className={playerPrefs.homePreviewMode === "screenshots" ? "active" : ""}
              onClick={() => updatePlayerPrefs({ homePreviewMode: "screenshots" })}
            >
              Кадры серии
            </button>
          </div>
        </Setting>
        <Setting
          title="Переход к плееру"
          description="При ручном выборе серии страница плавно прокручивается к плееру. Автопереключение экран не двигает."
          example="Нажатие на серию 8 сразу покажет плеер."
        >
          <Toggle
            label="Включён"
            value={playerPrefs.autoScrollPlayer}
            onChange={(value) => updatePlayerPrefs({ autoScrollPlayer: value })}
          />
        </Setting>
      </section>

      <section className="settings-group" data-settings-tab="player">
        <div className="settings-group-title">
          <b>Плеер</b>
          <span>Автоматизация и расположение элементов просмотра</span>
        </div>
        <Setting
          title="Автоскип опенинга"
          description="Автоматически перематывает опенинг, когда источник передал точный таймкод. Если таймкод отсутствует или ошибочен, кнопка и автопропуск могут быть недоступны."
          example="Плеер перескочит с 0:45 на 2:15."
        >
          <Toggle
            label="Включён"
            value={playerPrefs.autoSkipOpening}
            onChange={(value) => updatePlayerPrefs({ autoSkipOpening: value })}
          />
        </Setting>
        <Setting
          title="Автоскип эндинга"
          description="Отмечает серию просмотренной и перематывает эндинг по таймкоду источника. Для серий без корректного таймкода завершение определяется по общей длительности."
          example="На 22:40 плеер перейдёт к концу серии."
        >
          <Toggle
            label="Включён"
            value={playerPrefs.autoSkipEnding}
            onChange={(value) => updatePlayerPrefs({ autoSkipEnding: value })}
          />
        </Setting>
        <Setting
          title="Автосерия"
          description="После завершения текущей серии автоматически открывает и запускает следующую."
          example="После серии 4 сразу начнётся серия 5."
        >
          <Toggle
            label="Включён"
            value={playerPrefs.autoNext}
            onChange={(value) => updatePlayerPrefs({ autoNext: value })}
          />
        </Setting>
        <Setting
          title="Карусель серий"
          description="Показывает предыдущую и следующую серии по бокам плеера для быстрого переключения."
          example="Нажми на правую карточку, чтобы перейти к следующей серии."
        >
          <Toggle
            label="Включена"
            value={playerPrefs.playerEpisodeCarousel}
            onChange={(value) => updatePlayerPrefs({ playerEpisodeCarousel: value })}
          />
        </Setting>
        <Setting
          title="Миниатюры при наведении"
          description="Через полсекунды показывает доступные кадры конкретной серии над её карточкой. Если API не вернул уникальные кадры этой серии, миниатюра не показывается; это предотвращает подмену кадрами другого сезона."
          example="Наведи курсор на серию 3, чтобы увидеть её кадры."
        >
          <Toggle
            label="Включены"
            value={playerPrefs.episodeHoverPreview}
            onChange={(value) => updatePlayerPrefs({ episodeHoverPreview: value })}
          />
        </Setting>
        <Setting
          title="Компактный список серий"
          description="Включает более плотный новый вид серий под плеером. Выбор серии, прогресс, отметка просмотра, оценки и сворачивание сезонов остаются доступны."
          example="Удобно на телефоне и для длинных сезонов: на экране помещается больше серий."
        >
          <Toggle
            label="Новый вид"
            value={playerPrefs.compactEpisodeList}
            onChange={(value) => updatePlayerPrefs({ compactEpisodeList: value })}
          />
        </Setting>
        <Setting
          title="Панель управления"
          description="Определяет, с какой стороны плеера располагаются озвучка, серия, источник и настройки."
          example="На широком мониторе удобно расположение справа."
        >
          <select
            value={toolbar}
            onChange={(event) => updateToolbar(event.target.value as ToolbarPosition)}
          >
            <option value="bottom">Снизу</option>
            <option value="top">Сверху</option>
            <option value="left">Слева</option>
            <option value="right">Справа</option>
          </select>
        </Setting>
      </section>

      <section className="settings-group" data-settings-tab="watching">
        <div className="settings-group-title">
          <b>История</b>
          <span>Отдельная лента недавних просмотров</span>
        </div>
        <Setting
          title="Сохранять историю"
          description="Добавляет просмотренные серии в раздел истории. Прогресс просмотра сохраняется независимо от этой настройки."
          example="Можно отключить историю, не потеряв момент остановки."
        >
          <Toggle
            label="Включена"
            value={historyEnabled}
            onChange={onHistoryEnabledChange}
          />
        </Setting>
      </section>
    </>
  );
}
