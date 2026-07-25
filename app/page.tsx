"use client";

import { useEffect, useRef, useState } from "react";

const shows = [
  { id: 1, title: "Небесный рубеж", meta: "2025 · 12 серий", genre: "Фэнтези", color: "violet", progress: 63, episode: 7 },
  { id: 2, title: "Эхо Сибуи", meta: "2024 · 24 серии", genre: "Драма", color: "blue", progress: 24, episode: 4 },
  { id: 3, title: "Сад метеоров", meta: "2026 · 8 серий", genre: "Романтика", color: "rose", progress: 0, episode: 1 },
  { id: 4, title: "Стальной синто", meta: "2023 · 12 серий", genre: "Экшен", color: "amber", progress: 0, episode: 1 },
  { id: 5, title: "Последний сёгун", meta: "2025 · 16 серий", genre: "История", color: "red", progress: 0, episode: 1 },
  { id: 6, title: "Город духов", meta: "2024 · 10 серий", genre: "Мистика", color: "cyan", progress: 0, episode: 1 },
];

type Show = (typeof shows)[number];

export default function Home() {
  const [active, setActive] = useState<Show | null>(null);
  const [episode, setEpisode] = useState(7);
  const [dub, setDub] = useState("AniSoul");
  const [autoNext, setAutoNext] = useState(true);
  const [skipOpening, setSkipOpening] = useState(true);
  const [progress, setProgress] = useState(63);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("animesoul-progress");
    if (saved) {
      const data = JSON.parse(saved);
      setEpisode(data.episode ?? 7);
      setProgress(data.progress ?? 63);
      setDub(data.dub ?? "AniSoul");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("animesoul-progress", JSON.stringify({ episode, progress, dub }));
  }, [episode, progress, dub]);

  useEffect(() => {
    if (playing) {
      timer.current = setInterval(() => setProgress((value) => value >= 100 ? 0 : value + 0.25), 500);
    } else if (timer.current) clearInterval(timer.current);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing]);

  const openPlayer = (show: Show) => {
    setActive(show);
    setEpisode(show.id === 1 ? episode : show.episode);
    setProgress(show.id === 1 ? progress : show.progress);
    setPlaying(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 2200);
  };

  if (active) {
    return (
      <main className="app player-page">
        <Header onLogo={() => setActive(null)} />
        <section className="watch-shell">
          <button className="back" onClick={() => setActive(null)}>← К каталогу</button>
          <div className="watch-grid">
            <div>
              <div className={`video-stage art-${active.color}`}>
                <div className="ambient-orb one" />
                <div className="ambient-orb two" />
                <div className="video-copy">
                  <span>ANIMESOUL ORIGINAL</span>
                  <h2>{active.title}</h2>
                  <p>Серия {episode} · демо-режим</p>
                </div>
                <button className="play-button" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={() => setPlaying(!playing)}>
                  {playing ? "Ⅱ" : "▶"}
                </button>
                {skipOpening && progress > 8 && progress < 19 && (
                  <button className="skip-btn" onClick={() => { setProgress(21); flash("Опенинг пропущен"); }}>Пропустить опенинг →</button>
                )}
                <div className="video-controls">
                  <button onClick={() => setPlaying(!playing)}>{playing ? "Ⅱ" : "▶"}</button>
                  <span className="time">14:{String(Math.round(progress)).padStart(2, "0")} / 23:48</span>
                  <div className="seek"><i style={{ width: `${progress}%` }} /></div>
                  <button onClick={() => flash("Громкость: 80%")}>◖))</button>
                  <button onClick={() => flash("Качество: Авто 1080p")}>1080</button>
                  <button onClick={() => flash("Полноэкранный режим")}>⛶</button>
                </div>
              </div>
              <div className="watch-title">
                <div><span className="eyebrow">СМОТРИТЕ СЕЙЧАС</span><h1>{active.title}</h1><p>Серия {episode}: «За линией горизонта»</p></div>
                <button className="round-action" onClick={() => flash("Добавлено в избранное")}>♡</button>
              </div>
            </div>
            <aside className="episode-panel">
              <div className="panel-head"><div><span>СЕЗОН 1</span><h3>Серии</h3></div><span>{episode} / 12</span></div>
              <div className="episode-list">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((num) => (
                  <button key={num} className={num === episode ? "episode active" : "episode"} onClick={() => { setEpisode(num); setProgress(0); }}>
                    <b>{num}</b><span><strong>{num === 7 ? "За линией горизонта" : ["Новый рассвет", "Знак на воде", "Незнакомый голос"][num % 3]}</strong><small>23 мин.</small></span>
                    {num < episode && <em>✓</em>}
                  </button>
                ))}
              </div>
            </aside>
          </div>
          <div className="settings-bar">
            <label><span>Озвучка</span><select value={dub} onChange={(e) => setDub(e.target.value)}><option>AniSoul</option><option>Studio Nova</option><option>Оригинал + субтитры</option></select></label>
            <Toggle label="Пропускать опенинг" value={skipOpening} onChange={setSkipOpening} />
            <Toggle label="Следующая серия автоматически" value={autoNext} onChange={setAutoNext} />
            <div className="saved"><i>✓</i><span>Прогресс сохранён<br/><small>на этом устройстве</small></span></div>
          </div>
        </section>
        {notice && <div className="toast">{notice}</div>}
      </main>
    );
  }

  return (
    <main className="app">
      <Header onLogo={() => {}} />
      <section className="hero">
        <div className="hero-glow" />
        <div className="hero-content">
          <span className="premiere">ПРЕМЬЕРА НЕДЕЛИ</span>
          <h1>Истории, которые<br/>остаются <i>с тобой</i></h1>
          <p>Твоя личная аниме-библиотека. Без рекламы, без спешки — только ты и любимые миры.</p>
          <div className="hero-actions">
            <button className="primary" onClick={() => openPlayer(shows[0])}>▶ Продолжить смотреть</button>
            <button className="secondary" onClick={() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" })}>Открыть каталог ↓</button>
          </div>
          <div className="continue-note"><span>Серия {episode} из 12</span><div><i style={{ width: `${progress}%` }} /></div><b>{Math.round(progress)}%</b></div>
        </div>
        <div className="hero-art"><div className="moon"/><div className="silhouette"/><span>空の境界</span></div>
      </section>
      <section className="library" id="catalog">
        <div className="section-head"><div><span className="eyebrow">ТВОЯ КОЛЛЕКЦИЯ</span><h2>Продолжить просмотр</h2></div><button>Вся история →</button></div>
        <div className="cards">
          {shows.slice(0, 4).map((show) => <AnimeCard key={show.id} show={show} onOpen={openPlayer} />)}
        </div>
      </section>
      <section className="library catalog">
        <div className="section-head"><div><span className="eyebrow">ИССЛЕДУЙ</span><h2>Популярное сейчас</h2></div><div className="filters"><button className="selected">Все</button><button>Онгоинги</button><button>Фильмы</button></div></div>
        <div className="cards six">
          {shows.map((show) => <AnimeCard key={show.id} show={show} onOpen={openPlayer} compact />)}
        </div>
      </section>
      <footer><button className="brand"><span>魂</span> AnimeSoul</button><p>Личная библиотека для уютных вечеров.</p><span>Прототип · 2026</span></footer>
    </main>
  );
}

function Header({ onLogo }: { onLogo: () => void }) {
  return <header><button className="brand" onClick={onLogo}><span>魂</span> AnimeSoul</button><nav><a href="#catalog">Каталог</a><a href="#catalog">Моя коллекция</a><a href="#catalog">История</a></nav><div className="header-actions"><button aria-label="Поиск">⌕</button><button className="profile">DK</button></div></header>;
}

function AnimeCard({ show, onOpen, compact = false }: { show: Show; onOpen: (s: Show) => void; compact?: boolean }) {
  return <article className={compact ? "anime-card compact" : "anime-card"} onClick={() => onOpen(show)}>
    <div className={`poster art-${show.color}`}><div className="poster-mark">魂</div><span>{show.genre}</span><button aria-label={`Смотреть ${show.title}`}>▶</button></div>
    <h3>{show.title}</h3><p>{show.meta}</p>
    {show.progress > 0 && <div className="card-progress"><i style={{ width: `${show.progress}%` }}/><span>{show.progress}%</span></div>}
  </article>;
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="toggle-row"><button className={value ? "toggle on" : "toggle"} onClick={() => onChange(!value)} aria-label={label}><i /></button><span>{label}</span></label>;
}
