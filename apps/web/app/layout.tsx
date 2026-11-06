import type { Metadata } from "next";
import { SiteExperience } from "../components/SiteExperience";
import { ScrollReveals } from "../components/ScrollReveals";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { CardLibraryProvider } from "../components/CardLibrary";
import { ScrollCompass } from "../components/ScrollCompass";
import { HeaderScrollState } from "../components/HeaderScrollState";
import { FirstVisitGreeting } from "../components/FirstVisitGreeting";
import { siteConfiguration } from "../lib/site";
import { themeBootstrap } from "../lib/theme";
import { posterPaletteBootstrap } from "../lib/poster-palette";
import { greetingBootstrap } from "../lib/greeting";
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
        <script id="animesoul-greeting" dangerouslySetInnerHTML={{ __html: greetingBootstrap }} />
      </head>
      <body>
        <div className="poster-ambient" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="app">
          <div className="site-navigation-glass" aria-hidden="true" />
          {/* The library feeds the header's new-episode alerts as well as the pages. */}
          <CardLibraryProvider>
            <SiteHeader preview={preview} />
            <main id="main-content">
              <ScrollReveals />
              <SiteExperience />
              {children}
            </main>
          </CardLibraryProvider>
          <SiteFooter preview={preview} />
        </div>
        <HeaderScrollState />
        <ScrollCompass />
        <FirstVisitGreeting />
      </body>
    </html>
  );
}
