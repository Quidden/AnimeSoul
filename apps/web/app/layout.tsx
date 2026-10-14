import type { Metadata } from "next";
import { SiteExperience } from "../components/SiteExperience";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { CardLibraryProvider } from "../components/CardLibrary";
import { siteConfiguration } from "../lib/site";
import { themeBootstrap } from "../lib/theme";
import { posterPaletteBootstrap } from "../lib/poster-palette";
import "./globals.css";

// Origins, indexing and preview settings are supplied when the container starts.
export const dynamic = "force-dynamic";
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
    <html lang="ru" data-scroll-behavior="smooth" data-theme="lilac" suppressHydrationWarning>
      <head>
        <script id="animesoul-theme" dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script
          id="animesoul-poster-palette"
          dangerouslySetInnerHTML={{ __html: posterPaletteBootstrap }}
        />
      </head>
      <body>
        <div className="poster-ambient" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="app">
          <div className="site-navigation-glass" aria-hidden="true" />
          <SiteHeader preview={preview} />
          <CardLibraryProvider>
            <main id="main-content">
              <SiteExperience />
              {children}
            </main>
          </CardLibraryProvider>
          <SiteFooter preview={preview} />
        </div>
      </body>
    </html>
  );
}
