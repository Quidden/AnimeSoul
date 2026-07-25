import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "AnimeSoul — твоя личная аниме-библиотека",
  description: "Смотри аниме, сохраняй прогресс и создавай свою коллекцию.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "AnimeSoul — истории, которые остаются с тобой",
    description: "Личная аниме-библиотека без рекламы и спешки.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "AnimeSoul",
    description: "Истории, которые остаются с тобой.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
