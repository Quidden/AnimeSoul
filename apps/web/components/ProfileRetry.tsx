"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
export function ProfileRetry() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="outline"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Загружаем…" : "Повторить загрузку"}
    </button>
  );
}
