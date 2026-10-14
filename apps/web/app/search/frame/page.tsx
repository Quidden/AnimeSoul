import type { Metadata } from "next";
import Link from "next/link";
import { FrameSearch } from "../../../components/FrameSearch";
import { safeJsonLd, siteConfiguration } from "../../../lib/site";

export const dynamic = "force-dynamic";
const title = "Поиск аниме по фото, кадру и GIF";
const description =
  "Узнайте, из какого аниме картинка или GIF. Загрузите кадр: найдём название, серию и таймкод сцены, покажем похожие кадры и сохраним историю поиска.";
const questions = [
  {
    question: "Как найти аниме по фотографии или скриншоту?",
    answer:
      "Вставьте изображение из буфера, перетащите его в поиск или выберите файл. Поиск начнётся автоматически: в результатах появятся название аниме, серия и время сцены. Сезон показывается, если он указан в названии.",
  },
  {
    question: "Можно ли найти аниме по GIF?",
    answer:
      "Да. Для поиска используется первый кадр GIF. Если совпадение слабое, попробуйте другой кадр той же сцены.",
  },
  {
    question: "Какие изображения поддерживаются?",
    answer:
      "JPEG, PNG, WebP и GIF до 5 МБ и 4096 × 4096 пикселей. Полный кадр без обрезки, фильтров и крупных надписей обычно даёт более точный результат.",
  },
  {
    question: "Как посмотреть и очистить историю поиска?",
    answer:
      "Найденные аниме появляются в истории на этой странице и в поиске в шапке. Нажмите запись, чтобы открыть результат, или «Очистить историю кадров», чтобы удалить историю на этом устройстве.",
  },
];
export function generateMetadata(): Metadata {
  const site = siteConfiguration();
  return {
    title,
    description,
    alternates: { canonical: "/search/frame" },
    robots: { index: site.indexable, follow: site.indexable },
    openGraph: {
      title,
      description,
      type: "website",
      url: "/search/frame",
      siteName: "AnimeSoul",
      locale: "ru_RU",
      images: [{ url: "/animesoul-icon.png", alt: "AnimeSoul — поиск аниме по кадру" }],
    },
    twitter: { card: "summary", title, description, images: ["/animesoul-icon.png"] },
  };
}
export default function FrameSearchPage() {
  const site = siteConfiguration();
  const url = new URL("/search/frame", site.url).href;
  const structured = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: "AnimeSoul — поиск аниме по кадру",
        url,
        description,
        applicationCategory: "MultimediaApplication",
        operatingSystem: "Any",
        inLanguage: "ru",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "AnimeSoul", item: site.url.href },
          { "@type": "ListItem", position: 2, name: "Поиск аниме по кадру", item: url },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: questions.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };
  return (
    <div className="frame-search-page">
      <nav aria-label="Навигационная цепочка" className="frame-breadcrumb">
        <Link href="/search">Поиск</Link>
        <span>/</span>
        <span>По кадру</span>
      </nav>
      <p className="eyebrow">ПОИСК ПО ANIMESOUL</p>
      <h1>Из какого аниме этот кадр?</h1>
      <p className="frame-search-intro">
        Загрузите скриншот — найдём название, серию и время сцены.
      </p>
      <FrameSearch />
      <section className="frame-guide" aria-label="Как найти аниме по изображению">
        <h2>Найдите аниме по одному кадру</h2>
        <p>
          Увидели знакомую сцену в фотографии, скриншоте или GIF? Вставьте изображение или
          перетащите его в поиск. Сравните найденные кадры и откройте аниме в каталоге.
        </p>
        <h2>Вопросы о поиске по фото и GIF</h2>
        {questions.map(({ question, answer }) => (
          <details key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structured) }}
      />
    </div>
  );
}
