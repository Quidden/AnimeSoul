import type { Metadata } from "next";
import Link from "next/link";
import { siteConfiguration } from "../lib/site";
import "./globals.css";
const site = siteConfiguration();
export const metadata: Metadata = {
  metadataBase: site.url,
  title: { default: "AnimeSoul — мир аниме", template: "%s | AnimeSoul" },
  description: "Открывайте аниме, сохраняйте любимые истории и находите людей с похожим вкусом.",
  robots: { index: site.indexable, follow: site.indexable },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <header className="site-header">
          <nav aria-label="Основная навигация">
            <Link className="brand" href="/">
              <img src="/animesoul-icon.png" alt="" width="30" height="30" />
              Anime<span>Soul</span>
            </Link>
            <Link href="/catalog">Каталог</Link>
            {process.env.DEMO_CATALOG === "true" && <Link href="/users/soul">Профиль</Link>}
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          AnimeSoul <span>Истории, которые остаются с вами</span>
        </footer>
      </body>
    </html>
  );
}
