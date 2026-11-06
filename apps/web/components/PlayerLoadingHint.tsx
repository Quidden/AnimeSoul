"use client";
import { useEffect, useState } from "react";

export type ProgressStatus = "guest" | "loading" | "saved" | "error";

export function PlayerLoadingHint({
  loading,
  progressStatus,
}: {
  loading: boolean;
  progressStatus: ProgressStatus;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (!loading) return;
    const timer = setTimeout(() => setVisible(true), 8000);
    return () => clearTimeout(timer);
  }, [loading]);
  if (!loading || !visible) return null;
  return (
    <div className="player-loading-hint" role="status">
      <p>
        Если видео не запускается, попробуй другую озвучку. Выбор серии сохраняется в этом браузере.
      </p>
      <p>
        {progressStatus === "guest"
          ? "Войди в аккаунт, чтобы сохранять прогресс между устройствами."
          : progressStatus === "error"
            ? "Не удалось сохранить прогресс. Проверим соединение повторно."
            : progressStatus === "loading"
              ? "Проверяем сохранённый прогресс…"
              : "Прогресс просмотра сохраняется в аккаунте."}
      </p>
    </div>
  );
}
