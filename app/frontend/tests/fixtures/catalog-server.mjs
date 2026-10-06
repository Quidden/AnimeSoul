import http from 'node:http';

const base = [
  { anime_id: 4966, title: 'Звёздная история', year: 2024, type: {name: 'TV Сериал'}, rating: {average: 8.7}, anime_status: {title: 'Завершён'}, genres: [{title: 'Приключения', alias: 'adventure'}, {title: 'Фэнтези', alias: 'fantasy'}], description: 'История героев, отправившихся в большое путешествие. Их ждут новые миры, встречи и выбор, который изменит судьбу всей команды.', original: 'Star Story', poster: {big: '/animesoul-icon.png', fullsize: '/animesoul-icon.png'} },
  { anime_id: 4967, title: 'Звёздная история 2', year: 2025, type: {name: 'TV Сериал'}, rating: {average: 8.9}, anime_status: {title: 'Выходит'}, genres: [{title: 'Приключения', alias: 'adventure'}], description: 'Продолжение путешествия.', poster: {big: '/animesoul-icon.png'} },
  { anime_id: 4968, title: 'Звёздная история: Спецвыпуск', year: 2025, type: {name: 'Спецвыпуск'}, rating: {average: 8.1}, anime_status: {title: 'Завершён'}, poster: {big: '/animesoul-icon.png'} },
];
const anime = base.map(item => ({...item, viewing_order: base}));
http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:8000');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/api/yummy') {
    const mode = url.searchParams.get('mode');
    if (mode === 'details') {
      const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number);
      response.end(JSON.stringify({anime: anime.filter(item => ids.includes(item.anime_id))}));
    } else if (mode === 'catalog') response.end(JSON.stringify({anime}));
    else if (mode === 'videos') response.end(JSON.stringify({anime: anime[0], videos: [], _sources: {yummy: 'ok', kodik: 'ok'}}));
    else if (mode === 'schedule') response.end(JSON.stringify({schedule: []}));
    else response.end(JSON.stringify({success: true}));
    return;
  }
  if (url.pathname === '/api/gdrive/status') { response.end(JSON.stringify({connected: false, user_email: '', user_name: '', has_credentials: false, client_id: ''})); return; }
  if (url.pathname === '/api/storage') { response.statusCode = 503; response.end(JSON.stringify({error: 'QA read-only fixture'})); return; }
  response.end(JSON.stringify({}));
}).listen(8000, '127.0.0.1');
