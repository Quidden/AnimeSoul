import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AnimeSoul Admin",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
