import type { PlayerPrefs } from "../../lib/types";
import { Toggle } from "../../components/Toggle";
import { Setting } from "./Setting";

type Props = {
  playerPrefs: PlayerPrefs;
  updatePlayerPrefs: (partial: Partial<PlayerPrefs>) => void;
};

export function WatchPartySettings({ playerPrefs, updatePlayerPrefs }: Props) {
  return (
    <section className="settings-group" data-settings-tab="party">
      <div className="settings-group-title">
        <b>Совместный просмотр</b>
        <span>Комнаты через Hamachi, Tailscale или домашнюю сеть</span>
      </div>
      <Setting
        title="Разрешить совместный режим"
        description="Добавляет в настройки плеера создание комнаты, подключение по коду и список участников. Видео загружается отдельно у каждого человека."
      >
        <Toggle
          label="Включён"
          value={playerPrefs.watchPartyEnabled}
          onChange={(value) => updatePlayerPrefs({ watchPartyEnabled: value })}
        />
      </Setting>
      <Setting
        title="Имя участника"
        description="Это имя увидят остальные люди в комнате."
      >
        <input
          className="settings-text-input"
          value={playerPrefs.watchPartyName}
          maxLength={32}
          onChange={(event) => updatePlayerPrefs({ watchPartyName: event.target.value })}
        />
      </Setting>
      <Setting
        title="Адрес комнаты"
        description="Хост оставляет локальный адрес. Участник вводит IP компьютера хоста в Hamachi или Tailscale и порт 3002."
        example="http://25.10.20.30:3002"
      >
        <input
          className="settings-text-input"
          value={playerPrefs.watchPartyServer}
          onChange={(event) => updatePlayerPrefs({ watchPartyServer: event.target.value })}
        />
      </Setting>
      <Setting
        title="Правило комнаты"
        description="Выбирается хостом. В первом режиме только хост управляет синхронизированными участниками. Во втором любой синхронизированный участник может поставить паузу, запустить, перемотать или сменить серию у всех."
        example="Перед началом просмотра хост выбирает: «Все следуют за хостом» или «Все управляют на равных»."
      >
        <select
          value={playerPrefs.watchPartyRoomMode}
          onChange={(event) => updatePlayerPrefs({
            watchPartyRoomMode: event.target.value as "host" | "shared",
          })}
        >
          <option value="host">Все следуют за хостом</option>
          <option value="shared">Все управляют на равных</option>
        </select>
      </Setting>
      <Setting
        title="Мой личный режим"
        description="Синхронизированный режим подчиняется правилу комнаты. Свободный просмотр доступен каждому участнику в любой момент и временно отделяет только его плеер от общих команд."
        example="При медленном интернете включи свободный режим, дождись загрузки и затем нажми «Перейти к общему таймкоду»."
      >
        <select
          value={playerPrefs.watchPartyMode}
          onChange={(event) => updatePlayerPrefs({
            watchPartyMode: event.target.value as "follow" | "free",
          })}
        >
          <option value="follow">Следовать за хостом</option>
          <option value="free">Свободный просмотр / Режим медленного интернета</option>
        </select>
      </Setting>
      <Setting
        title="Озвучка в комнате"
        description="Своя озвучка не меняется. Режим предложения показывает выбор при смене озвучки хостом. Полное следование переключает её автоматически, если такая озвучка доступна у участника."
        example="Хост выбрал AniLibria — можно переключиться одним нажатием или оставить свою озвучку."
      >
        <select
          value={playerPrefs.watchPartyDubMode}
          onChange={(event) => updatePlayerPrefs({
            watchPartyDubMode: event.target.value as "own" | "suggest" | "follow",
          })}
        >
          <option value="own">Своя у каждого</option>
          <option value="suggest">Предлагать озвучку хоста</option>
          <option value="follow">Следовать за озвучкой хоста</option>
        </select>
      </Setting>
      <Setting
        title="Автоматически догонять хоста"
        description="При расхождении больше пяти секунд плеер перематывается на позицию хоста. При выключении доступна ручная кнопка «Догнать»."
      >
        <Toggle
          label="Включено"
          value={playerPrefs.watchPartyAutoCatchUp}
          onChange={(value) => updatePlayerPrefs({ watchPartyAutoCatchUp: value })}
        />
      </Setting>
      <Setting
        title="Положение участников"
        description="Определяет, где рядом с плеером показывается состояние комнаты."
      >
        <select
          value={playerPrefs.watchPartyPanelPosition}
          onChange={(event) => updatePlayerPrefs({
            watchPartyPanelPosition: event.target.value as "top" | "bottom" | "overlay",
          })}
        >
          <option value="top">Над плеером</option>
          <option value="bottom">Под плеером</option>
          <option value="overlay">Поверх плеера</option>
        </select>
      </Setting>
      <WatchPartyGuide />
    </section>
  );
}

function WatchPartyGuide() {
  return (
    <details className="watch-party-guide">
      <summary>
        <span>
          <b>Как запустить совместный просмотр</b>
          <small>Инструкция для хоста и участников · решение проблем</small>
        </span>
        <i>⌄</i>
      </summary>
      <div className="watch-party-guide-content">
        <section>
          <h3>Что понадобится</h3>
          <ol>
            <li>У каждого участника должна быть установлена и запущена AnimeSoul.</li>
            <li>
              Все должны находиться в одной виртуальной сети либо в одной домашней сети.
              Скачать: <a href="https://vpn.net/" target="_blank" rel="noreferrer">Hamachi</a> или{" "}
              <a href="https://tailscale.com/download/windows" target="_blank" rel="noreferrer">
                Tailscale
              </a>
              .
            </li>
            <li>
              На компьютере хоста локальный сервер AnimeSoul должен быть доступен на порту{" "}
              <code>3002</code>.
            </li>
            <li>
              Одинаковые файлы сохранений не нужны: видео и прогресс у каждого загружаются
              независимо.
            </li>
          </ol>
        </section>
        <section>
          <h3>Хост: создание комнаты</h3>
          <ol>
            <li>Запусти AnimeSoul через штатный BAT-файл или десктопное приложение.</li>
            <li>
              Оставь адрес комнаты <code>http://127.0.0.1:3002</code>.
            </li>
            <li>Открой нужное аниме, включи «Совместный режим» в настройках плеера.</li>
            <li>Выбери правило комнаты: управление только хостом или равноправное управление.</li>
            <li>Нажми «Создать комнату» и отправь появившийся код друзьям.</li>
            <li>
              При необходимости роль хоста можно передать любому подключённому участнику прямо
              в списке комнаты.
            </li>
          </ol>
        </section>
        <section>
          <h3>Участник: подключение</h3>
          <ol>
            <li>
              Узнай виртуальный IP хоста в Hamachi/Tailscale, например <code>25.10.20.30</code>.
            </li>
            <li>
              В поле «Адрес комнаты» укажи <code>http://25.10.20.30:3002</code>.
            </li>
            <li>Открой то же аниме, включи совместный режим и введи полученный код комнаты.</li>
            <li>
              Выбери личный режим. «Свободный просмотр / Режим медленного интернета» доступен
              всегда, независимо от правила комнаты.
            </li>
          </ol>
        </section>
        <section>
          <h3>Как работают режимы</h3>
          <dl>
            <div>
              <dt>Все следуют за хостом</dt>
              <dd>
                Только хост управляет общим запуском, паузой, серией и таймкодом. Остальные
                синхронизированные участники повторяют его действия.
              </dd>
            </div>
            <div>
              <dt>Все управляют на равных</dt>
              <dd>
                Любой участник в синхронизированном режиме может поставить видео на паузу,
                продолжить, перемотать или выбрать серию — команда применяется у всех
                синхронизированных участников.
              </dd>
            </div>
            <div>
              <dt>Свободный просмотр / медленный интернет</dt>
              <dd>
                Это не правило комнаты, а личный режим. Он доступен всем, включая хоста, в любой
                момент. Общие команды не двигают твой плеер, а твои действия не мешают остальным.
                Таймкоды участников остаются видны, вернуться можно кнопкой «Перейти к общему
                таймкоду».
              </dd>
            </div>
            <div>
              <dt>Передача хоста</dt>
              <dd>
                Текущий хост нажимает «Передать хоста» рядом с именем участника. Новый хост сразу
                получает право менять правило комнаты; при выходе хоста роль автоматически
                передаётся одному из оставшихся участников.
              </dd>
            </div>
            <div>
              <dt>Своя озвучка</dt>
              <dd>
                У каждого остаётся выбранная им озвучка. Серия синхронизируется, но голосовая
                дорожка не меняется.
              </dd>
            </div>
            <div>
              <dt>Предлагать озвучку хоста</dt>
              <dd>
                При смене озвучки появляется предложение «Переключиться» или «Оставить мою». Без
                подтверждения AnimeSoul ничего не меняет.
              </dd>
            </div>
            <div>
              <dt>Следовать за озвучкой хоста</dt>
              <dd>
                Озвучка меняется автоматически, если она доступна для этой серии. При отсутствии
                AnimeSoul оставляет доступную локальную озвучку и показывает предупреждение.
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Совместимость видеоплееров</h3>
          <dl>
            <div>
              <dt>Kodik</dt>
              <dd>
                Поддерживает полную синхронизацию AnimeSoul: серия, озвучка, запуск, пауза,
                перемотка и точный таймкод.
              </dd>
            </div>
            <div>
              <dt>Другие источники</dt>
              <dd>
                Выбор серии и озвучки синхронизируется нашей оболочкой. Пауза, запуск, перемотка
                и точный таймкод работают только тогда, когда встроенный плеер отдаёт совместимые
                события управления.
              </dd>
            </div>
            <div>
              <dt>Почему у участников может быть разный результат</dt>
              <dd>
                Набор озвучек и источников иногда отличается между сериями. Для предсказуемого
                совместного просмотра всем участникам рекомендуется выбрать Kodik.
              </dd>
            </div>
          </dl>
        </section>
        <section className="watch-party-troubleshooting">
          <h3>Проблемы и решения</h3>
          <dl>
            <div>
              <dt>«Сервер комнаты недоступен» или Not found</dt>
              <dd>
                Полностью перезапусти AnimeSoul. Убедись, что адрес заканчивается на{" "}
                <code>:3002</code>, а не на порт сайта <code>:3001</code>.
              </dd>
            </div>
            <div>
              <dt>Друг не подключается</dt>
              <dd>
                Проверь, что вы видите друг друга в Hamachi/Tailscale. Разреши Node.js/AnimeSoul в
                брандмауэре Windows для частных сетей и открой TCP-порт 3002.
              </dd>
            </div>
            <div>
              <dt>Высокий пинг</dt>
              <dd>
                Переключись в свободный режим. Пинг комнаты показан в верхнем баре; он относится
                к командам синхронизации, а не к скорости загрузки видео.
              </dd>
            </div>
            <div>
              <dt>Видео у друга загружается медленнее</dt>
              <dd>
                Это не останавливает остальных: каждый получает видео от источника отдельно.
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </details>
  );
}
