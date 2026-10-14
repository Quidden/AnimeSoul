import type { Metadata } from "next";
import "./globals.css";
import { AdminAccess } from "../components/AdminAccess";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "AnimeSoul Admin",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <AdminAccess siteUrl={process.env.SITE_URL ?? "http://localhost:8021"} />
        {children}
      </body>
    </html>
  );
}
