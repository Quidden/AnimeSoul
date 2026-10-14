"use client";
import { useState, type FormEvent } from "react";
import {
  subscriptionPlanSchema,
  subscriptionQuote,
  type SubscriptionAdmin,
  type SubscriptionPlan,
  type SubscriptionPromotion,
} from "@animesoul/contracts";
import { SaveTemplate } from "./platform/TemplateTools";
import { api, useData, date, localDate } from "./platform/api";
import { Loading, Notice, useConfirmation } from "./platform/Common";
export function SubscriptionManagement({
  csrf,
  mode = "plans",
}: {
  csrf: string;
  mode?: "plans" | "promotions";
}) {
  const { ask, confirmation } = useConfirmation();
  const state = useData<SubscriptionAdmin>("/api/admin/subscriptions"),
    [plan, setPlan] = useState<SubscriptionPlan | null>(null),
    [offer, setOffer] = useState<Partial<SubscriptionPromotion> | null>(null),
    [creating, setCreating] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>, kind: "plan" | "promotion") {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      const data =
        kind === "plan"
          ? {
              ...plan,
              id: form.get("id"),
              name: form.get("name"),
              description: form.get("description"),
              months: Number(form.get("months")),
              sortOrder: Number(form.get("sortOrder")),
              amountMinor:
                form.get("price") === "" ? null : Math.round(Number(form.get("price")) * 100),
              currency: form.get("currency"),
              permissions: form.has("native") ? ["player.native"] : [],
              enabled: form.has("enabled"),
              create: creating,
              version: plan?.version ?? 0,
            }
          : {
              ...(offer?.id ? { id: offer.id } : {}),
              name: form.get("name"),
              description: form.get("description"),
              percent: Number(form.get("percent")),
              planIds: form.getAll("planIds"),
              months: String(form.get("months")).trim()
                ? String(form.get("months")).split(",").map(Number)
                : [],
              startsAt: new Date(String(form.get("startsAt"))).toISOString(),
              endsAt: new Date(String(form.get("endsAt"))).toISOString(),
              enabled: form.has("enabled"),
              version: offer?.version ?? 0,
            };
      if (
        !(await ask(
          "Сохранить параметры? Уже выданный доступ и стоимость существующих заказов сохранятся.",
        ))
      )
        return;
      state.setData(
        await api<SubscriptionAdmin>(
          "/api/admin/subscriptions/" + kind,
          { ...data, reason: form.get("reason"), operationId: crypto.randomUUID() },
          csrf,
        ),
      );
      setPlan(null);
      setOffer(null);
      setNotice("Изменения сохранены.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Проверьте параметры и даты.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {confirmation}
      <p className="muted">
        7 дней пробного доступа для новых аккаунтов; затем 50% на первый месячный тариф. Акции не
        суммируются. Оплата пока отключена. Доступ пользователей назначается в разделе
        «Пользователи».
      </p>
      <Loading {...state} />
      <Notice text={notice} />
      {state.data && (
        <>
          {mode === "plans" ? (
            <>
              <button
                onClick={() => {
                  setCreating(true);
                  setPlan(
                    subscriptionPlanSchema.parse({
                      id: "new-plan",
                      name: "Новый тариф",
                      months: 1,
                      amountMinor: null,
                      currency: "UAH",
                      enabled: false,
                    }),
                  );
                }}
              >
                Создать тариф
              </button>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Порядок / ID</th>
                      <th>Название</th>
                      <th>Срок</th>
                      <th>Цена</th>
                      <th>Права</th>
                      <th>Статус</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.plans.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.sortOrder} · {p.id}
                        </td>
                        <td>
                          {p.name}
                          <small className="block muted">{p.description}</small>
                        </td>
                        <td>{p.months} мес.</td>
                        <td>
                          {p.amountMinor === null
                            ? "Не назначена"
                            : `${p.amountMinor / 100} ${p.currency}`}
                        </td>
                        <td>{p.permissions.join(", ") || "Нет"}</td>
                        <td>{p.enabled ? "Включён" : "Отключён"}</td>
                        <td>
                          <button
                            onClick={() => {
                              setCreating(false);
                              setPlan(p);
                            }}
                          >
                            Редактировать
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {plan && (
                <form
                  className="panel edit-form"
                  key={plan.id + plan.version}
                  onSubmit={(e) => void save(e, "plan")}
                >
                  <div className="section-heading">
                    <h2>{creating ? "Новый тариф" : "Изменение тарифа"}</h2>
                    <button type="button" onClick={() => setPlan(null)}>
                      Закрыть
                    </button>
                  </div>
                  <fieldset disabled={busy}>
                    <label>
                      ID
                      <input
                        name="id"
                        required
                        readOnly={!creating}
                        defaultValue={plan.id}
                        pattern="[a-z0-9-]{1,40}"
                      />
                    </label>
                    <label>
                      Название
                      <input name="name" required maxLength={80} defaultValue={plan.name} />
                    </label>
                    <label>
                      Описание
                      <textarea
                        name="description"
                        maxLength={1000}
                        defaultValue={plan.description}
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        Месяцев
                        <input
                          name="months"
                          type="number"
                          min={1}
                          max={24}
                          required
                          defaultValue={plan.months}
                        />
                      </label>
                      <label>
                        Порядок
                        <input
                          name="sortOrder"
                          type="number"
                          min={0}
                          max={10000}
                          defaultValue={plan.sortOrder}
                        />
                      </label>
                      <label>
                        Цена за весь срок
                        <input
                          name="price"
                          type="number"
                          min={0.01}
                          max={100000}
                          step={0.01}
                          defaultValue={plan.amountMinor === null ? "" : plan.amountMinor / 100}
                        />
                      </label>
                      <label>
                        Валюта
                        <select name="currency" defaultValue={plan.currency}>
                          <option>UAH</option>
                          <option>USD</option>
                          <option>EUR</option>
                        </select>
                      </label>
                    </div>
                    <label className="check">
                      <input
                        name="native"
                        type="checkbox"
                        defaultChecked={plan.permissions.includes("player.native")}
                      />
                      Доступ к плееру AnimeSoul
                    </label>
                    <label className="check">
                      <input name="enabled" type="checkbox" defaultChecked={plan.enabled} />
                      Тариф включён
                    </label>
                    <label>
                      Причина
                      <input name="reason" minLength={3} maxLength={500} required />
                    </label>
                    <button>Сохранить тариф</button>
                  </fieldset>
                  <SaveTemplate kind="plan" payload={plan} csrf={csrf} />
                </form>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() =>
                  setOffer({
                    name: "",
                    description: "",
                    percent: 10,
                    planIds: [],
                    months: [],
                    startsAt: new Date().toISOString(),
                    endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
                    enabled: false,
                    version: 0,
                  })
                }
              >
                Создать акцию
              </button>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Название</th>
                      <th>Скидка</th>
                      <th>Тарифы</th>
                      <th>Период</th>
                      <th>Статус</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.promotions.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{p.percent}%</td>
                        <td>{p.planIds.join(", ") || "Все"}</td>
                        <td>
                          {date(p.startsAt)} — {date(p.endsAt)}
                        </td>
                        <td>
                          {!p.enabled
                            ? "Отключена"
                            : new Date(p.startsAt) > new Date()
                              ? "Запланирована"
                              : new Date(p.endsAt) <= new Date()
                                ? "Завершена"
                                : "Активна"}
                        </td>
                        <td>
                          <button onClick={() => setOffer(p)}>Редактировать</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {offer && (
                <div className="two-columns">
                  <form
                    className="panel"
                    key={offer.id ?? "new"}
                    onSubmit={(e) => void save(e, "promotion")}
                  >
                    <div className="section-heading">
                      <h2>{offer.id ? "Редактирование акции" : "Новая акция"}</h2>
                      <button type="button" onClick={() => setOffer(null)}>
                        Закрыть
                      </button>
                    </div>
                    <fieldset disabled={busy}>
                      <label>
                        Название
                        <input
                          name="name"
                          required
                          maxLength={100}
                          value={offer.name ?? ""}
                          onChange={(e) => setOffer({ ...offer, name: e.target.value })}
                        />
                      </label>
                      <label>
                        Описание
                        <textarea
                          name="description"
                          maxLength={1000}
                          value={offer.description ?? ""}
                          onChange={(e) => setOffer({ ...offer, description: e.target.value })}
                        />
                      </label>
                      <label>
                        Скидка, %
                        <input
                          name="percent"
                          type="number"
                          min={1}
                          max={100}
                          required
                          value={offer.percent ?? 10}
                          onChange={(e) => setOffer({ ...offer, percent: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        Тарифы (пусто — все)
                        <select
                          name="planIds"
                          multiple
                          value={offer.planIds ?? []}
                          onChange={(e) =>
                            setOffer({
                              ...offer,
                              planIds: Array.from(e.target.selectedOptions).map((o) => o.value),
                            })
                          }
                        >
                          {state.data!.plans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Сроки тарифов, через запятую
                        <input name="months" defaultValue={offer.months?.join(",")} />
                      </label>
                      <label>
                        Начало
                        <input
                          name="startsAt"
                          type="datetime-local"
                          required
                          defaultValue={localDate(offer.startsAt)}
                        />
                      </label>
                      <label>
                        Окончание
                        <input
                          name="endsAt"
                          type="datetime-local"
                          required
                          defaultValue={localDate(offer.endsAt)}
                        />
                      </label>
                      <label className="check">
                        <input name="enabled" type="checkbox" defaultChecked={offer.enabled} />
                        Акция включена
                      </label>
                      <label>
                        Причина
                        <input name="reason" minLength={3} maxLength={500} required />
                      </label>
                      <button>Сохранить акцию</button>
                    </fieldset>
                    <SaveTemplate kind="promotion" payload={offer} csrf={csrf} />
                  </form>
                  <section className="panel">
                    <h2>Предпросмотр скидки</h2>
                    <p>
                      {offer.name} · {offer.percent}%
                    </p>
                    <table>
                      <thead>
                        <tr>
                          <th>Тариф</th>
                          <th>Цена</th>
                          <th>По акции</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.data.plans
                          .filter((p) => !offer.planIds?.length || offer.planIds.includes(p.id))
                          .map((p) => (
                            <tr key={p.id}>
                              <td>{p.name}</td>
                              <td>{p.amountMinor === null ? "Не задана" : p.amountMinor / 100}</td>
                              <td>
                                {p.amountMinor === null
                                  ? "Не задана"
                                  : Math.round(
                                      (p.amountMinor * (100 - (offer.percent ?? 0))) / 100,
                                    ) / 100}{" "}
                                {p.currency}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    <p className="muted">
                      Фактическая скидка выбирается с учётом периода, срока тарифа и первого месяца
                      после пробного периода.
                    </p>
                  </section>
                </div>
              )}
              <details>
                <summary>Действующие предложения с учётом всех акций</summary>
                <table>
                  <tbody>
                    {state.data.plans.map((p) => {
                      const quoted = subscriptionQuote(p, state.data!.promotions, false);
                      return (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td>{quoted.discountPercent}%</td>
                          <td>
                            {quoted.finalAmountMinor === null
                              ? "Цена не задана"
                              : quoted.finalAmountMinor / 100}{" "}
                            {p.currency}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </>
      )}
    </>
  );
}
