import type { Metadata } from "next";
import { SubscriptionPageContent } from "../../components/SubscriptionPreview";
import { siteConfiguration } from "../../lib/site";
export function generateMetadata(): Metadata {
  const site = siteConfiguration();
  return {
    title: "AnimeSoul Plus — плеер и подписка",
    description:
      "Попробуйте плеер AnimeSoul бесплатно 7 дней: удобный выбор серий и озвучек, качество, скорость и улучшение изображения. Тарифы и преимущества AnimeSoul Plus.",
    alternates: { canonical: new URL("/subscription", site.url).href },
    robots: { index: site.indexable, follow: site.indexable },
  };
}
export default function SubscriptionPage() {
  return (
    <section className="subscription-page" aria-label="Плеер и подписка AnimeSoul Plus">
      <h1 className="visually-hidden">Плеер и подписка AnimeSoul Plus</h1>
      <SubscriptionPageContent />
    </section>
  );
}
