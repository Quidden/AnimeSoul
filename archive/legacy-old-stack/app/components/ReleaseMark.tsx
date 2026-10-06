import type { Anime } from "../lib/types";
import { releaseStatus } from "../lib/anime";

export function ReleaseMark({
  anime,
  status: provided,
}: {
  anime?: Anime;
  status?: { label: string; kind: string };
}) {
  if (!anime && !provided) return null;
  const status = provided ?? releaseStatus(anime!);
  return (
    <span className={`inline-release ${status.kind}`}>
      <i />
      {status.label}
    </span>
  );
}
