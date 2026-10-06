import type { Metadata } from "next";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
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
  const preview = process.env.DEMO_CATALOG === "true";
  return (
    <html lang="ru">
      <body>
        <div className="app">
          <SiteHeader preview={preview} />
          <main id="main-content">{children}</main>
          <SiteFooter preview={preview} />
        </div>
      </body>
    </html>
  );
}
