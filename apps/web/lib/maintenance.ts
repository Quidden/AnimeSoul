import type { MaintenanceSettings } from "@animesoul/contracts";
export function maintenanceHtml(
  settings: Pick<MaintenanceSettings, "title" | "body" | "endsAt">,
  path = "/",
) {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  const eta = settings.endsAt
    ? `<p class="eta">Ориентировочно вернёмся ${escape(new Date(settings.endsAt).toLocaleString("ru-RU", { timeZone: "Europe/Kyiv", dateStyle: "long", timeStyle: "short" }))} (Киев)</p>`
    : "";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(settings.title)} | AnimeSoul</title><style>
  :root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#131018;color:#f6f2fb}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at top,#302343 0,transparent 60%)}main{width:min(680px,100%);padding:clamp(24px,6vw,56px);border:1px solid #43364f;border-radius:24px;background:#19151edb}.brand{font-size:16px;letter-spacing:.18em;color:#bd9aff}.status{display:inline-block;margin-top:32px;padding:6px 12px;border-radius:20px;background:#ad84f520;color:#cab0ff;font-size:14px}h1{font-size:clamp(26px,5vw,42px);line-height:1.18;overflow-wrap:anywhere;margin:20px 0}.body{white-space:pre-wrap;overflow-wrap:anywhere;color:#cdc1d8;line-height:1.75}.eta{color:#ac9dbb;font-size:14px;line-height:1.5}a{display:inline-block;margin-top:24px;background:#9c79e5;color:#fff;border-radius:12px;padding:13px 20px;text-decoration:none;font-weight:600}a:hover{background:#ae8bf5}a:focus-visible{outline:3px solid #ede1ff;outline-offset:4px}@media(prefers-color-scheme:light){:root{color-scheme:light;background:#f6f3fb;color:#251d31}body{background:radial-gradient(ellipse at top,#e6dcf6 0,transparent 65%)}main{background:#fffffff0;border-color:#dcd1e8}.body{color:#554565}.eta{color:#71627f}.status{color:#7550af}}
  </style></head><body><main><div class="brand">ANIMESOUL</div><div class="status">Обновление сайта</div><h1>${escape(settings.title)}</h1><p class="body">${escape(settings.body)}</p>${eta}<a href="${escape(path)}">Проверить доступность</a></main></body></html>`;
}
