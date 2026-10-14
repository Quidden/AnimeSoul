"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Subscription } from "@animesoul/contracts";
import { useSubscription } from "./useSubscription";
import { SubscriptionPlayerDemo } from "./SubscriptionPlayerDemo";
import { SubscriptionGallery } from "./SubscriptionGallery";
export function SubscriptionContent({
  value,
  ready,
  error,
  retry,
}: {
  value: Subscription | null;
  ready: boolean;
  error: boolean;
  retry: () => void;
}) {
  const [selected, setSelected] = useState("monthly");
  const selectedPlan = value?.plans.find((p) => p.id === selected) ?? value?.plans[0];
  const date = value?.expiresAt
    ? new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" }).format(
        new Date(value.expiresAt),
      )
    : null;
  return (
    <div className="subscription-content">
      <div className="subscription-intro">
        <span className="eyebrow">ANIMESOUL PLUS</span>
        <h2 id="subscription-title">Смотри в своём ритме</h2>
        <p>
          Наш плеер объединяет серии, озвучки и настройки в одном месте. Меньше переключений, больше
          аниме.
        </p>
        {value?.nativeAccess ? (
          <p className="subscription-access" role="status">
            {value.source === "trial" ? "Пробный доступ" : "Плеер AnimeSoul доступен"}
            {date ? ` до ${date}` : ""}.
          </p>
        ) : (
          <p className="subscription-trial">
            7 дней бесплатно для новых аккаунтов. Затем −50% на первый месяц подписки.
          </p>
        )}
        <a className="subscription-plans-link" href="#subscription-plans-title">
          Тарифы и пробный доступ
        </a>
      </div>
      <SubscriptionPlayerDemo />
      <SubscriptionGallery />
      <section className="subscription-plans" aria-labelledby="subscription-plans-title">
        <h3 id="subscription-plans-title">Выбери свой план</h3>
        {!ready ? (
          <p role="status">Загружаем тарифы…</p>
        ) : error ? (
          <div role="alert">
            <p>Не удалось загрузить тарифы и доступ.</p>
            <button className="outline" onClick={retry}>
              Повторить
            </button>
          </div>
        ) : value?.plans.length ? (
          <div className="subscription-plan-grid" role="group" aria-label="Тарифы">
            {value.plans.map((plan) => (
              <button
                key={plan.id}
                className="subscription-plan"
                aria-pressed={selectedPlan?.id === plan.id}
                onClick={() => setSelected(plan.id)}
              >
                <strong>{plan.name}</strong>
                <span className="subscription-price">
                  {plan.finalAmountMinor === null
                    ? "Цена скоро"
                    : new Intl.NumberFormat("ru", {
                        style: "currency",
                        currency: plan.currency,
                        maximumFractionDigits: 2,
                      }).format(plan.finalAmountMinor / 100)}
                </span>
                {plan.amountMinor !== null && plan.discountPercent > 0 && (
                  <del>
                    {new Intl.NumberFormat("ru", {
                      style: "currency",
                      currency: plan.currency,
                    }).format(plan.amountMinor / 100)}
                  </del>
                )}
                {plan.discountPercent > 0 && (
                  <span className="subscription-discount">
                    −{plan.discountPercent}% · {plan.discountName}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p>Тарифы скоро появятся.</p>
        )}
        {value?.firstMonthDiscount && (
          <p className="subscription-discount">
            Тебе доступна скидка 50% на первый месячный план. Скидки не суммируются; применяется
            самая выгодная.
          </p>
        )}
        <div className="subscription-cta">
          {!value?.authenticated && ready && !error ? (
            <>
              <Link className="primary" href="/account?mode=register#account-sign-in">
                Попробовать 7 дней бесплатно
              </Link>
              <Link className="outline" href="/account#account-sign-in">
                У меня есть аккаунт
              </Link>
            </>
          ) : value?.nativeAccess ? (
            <Link className="outline" href="/catalog">
              Выбрать аниме
            </Link>
          ) : (
            <button className="primary" disabled>
              {selectedPlan ? `${selectedPlan.name} · оплата скоро` : "Подписка скоро"}
            </button>
          )}
        </div>
        <p className="subscription-billing-note">
          Оплату подключим скоро. Пробный доступ начинается после регистрации и заканчивается через
          7 дней; автоматического списания нет.
        </p>
      </section>
    </div>
  );
}
export function SubscriptionPreview({
  open,
  onClose,
  subscription,
}: {
  open: boolean;
  onClose: () => void;
  subscription: ReturnType<typeof useSubscription>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  return (
    <dialog
      className="subscription-dialog"
      ref={dialog}
      aria-labelledby="subscription-title"
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onClose();
        }
      }}
    >
      <button
        className="subscription-close outline"
        aria-label="Закрыть предпросмотр подписки"
        onClick={onClose}
      >
        ×
      </button>
      {open && (
        <SubscriptionContent
          value={subscription.value}
          ready={subscription.ready}
          error={subscription.error}
          retry={() => void subscription.refresh()}
        />
      )}
    </dialog>
  );
}
export function SubscriptionPageContent() {
  const subscription = useSubscription();
  return (
    <SubscriptionContent
      value={subscription.value}
      ready={subscription.ready}
      error={subscription.error}
      retry={() => void subscription.refresh()}
    />
  );
}
