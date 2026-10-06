import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_SITE_PORT, readConfig, saveConfig, validatePort, validateYummyToken } from "./config.mjs";

export async function ensureCliConfig(file) {
  const existing = await readConfig(file);
  if (existing?.yummyAnimeToken) return existing;
  const prompt = createInterface({ input, output });
  try {
    output.write("\nПервоначальная настройка AnimeSoul\n");
    output.write(`Настройки сохранятся в ${file}\n\n`);
    output.write("Огромная благодарность разработчикам YummyAnime за предоставленный API.\n");
    output.write("Только благодаря их работе стало возможным создание AnimeSoul.\n\n");
    output.write("Где взять ключ:\n");
    output.write("1. Открой https://api.yani.tv/swagger\n");
    output.write("2. В разделе Introduction нажми ссылку here.\n");
    output.write("3. Авторизуйся, создай новое приложение и скопируй Public token.\n");
    output.write("Приватный токен AnimeSoul не нужен. API предназначен только для личного использования.\n\n");
    output.write("AnimeSoul не распространяет общий ключ: неизвестно, разрешено ли включать его в open-source\n");
    output.write("проект и как общая нагрузка отразится на его работе. Поэтому каждому нужен собственный ключ.\n");
    output.write("Для личного использования им можно поделиться с несколькими друзьями с учётом правил API.\n\n");
    let sitePort = DEFAULT_SITE_PORT;
    while (true) {
      const answer = (await prompt.question(`Порт сайта [${DEFAULT_SITE_PORT}]: `)).trim();
      sitePort = Number(answer || DEFAULT_SITE_PORT);
      const result = await validatePort(sitePort);
      if (result.ok) break;
      output.write(`Ошибка: ${result.error}\n`);
    }
    let yummyAnimeToken = "";
    while (true) {
      yummyAnimeToken = (await prompt.question("Публичный ключ API YummyAnime: ")).trim();
      output.write("Проверяем ключ...\n");
      const result = await validateYummyToken(yummyAnimeToken);
      if (result.ok) break;
      output.write(`Ошибка: ${result.error}\n`);
    }
    const config = await saveConfig(file, { sitePort, yummyAnimeToken });
    output.write(`\nНастройки сохранены. Их можно изменить вручную в ${file} при закрытом AnimeSoul.\n`);
    return config;
  } finally {
    prompt.close();
  }
}
