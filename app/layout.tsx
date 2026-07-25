import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AnimeSoul — локальная аниме-библиотека",
  description: "Каталог аниме с русскими озвучками, рейтингами и локальным прогрессом просмотра.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
