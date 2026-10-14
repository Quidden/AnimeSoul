import type { CharacterSummary, GlobalSearchResponse, Person } from "@animesoul/contracts";

export type SearchOption = {
  id: string;
  label: string;
  detail: string;
  group: string;
  kind: "anime" | "character" | "person" | "setting" | "filter";
  href?: string;
  completion: string;
  caret?: number;
  poster?: string | null;
  badge?: string | undefined;
  anime?: GlobalSearchResponse["anime"][number];
  character?: CharacterSummary;
  person?: Person;
};

export const searchPreviewDelay = 900;
export type PreviewPoint = { x: number; y: number };
export type SearchPreviewAnchor = { left: number; top: number; width: number; height: number };
export type SearchPreviewSnapshot = {
  option: SearchOption;
  anchor: SearchPreviewAnchor;
  container: { width: number; height: number };
};

// Ignore small hand tremors, but require a new pause after intentional movement.
export function searchPreviewMoved(origin: PreviewPoint, point: PreviewPoint) {
  return Math.hypot(point.x - origin.x, point.y - origin.y) > 6;
}

export function searchPreviewPlacement(
  snapshot: Pick<SearchPreviewSnapshot, "anchor" | "container">,
  height: number,
) {
  const { anchor, container } = snapshot;
  const gap = Math.min(12, container.width / 4, container.height / 4);
  const width = Math.min(560, container.width - gap * 2);
  const maxHeight = container.height - gap * 2;
  return {
    left: Math.max(gap, Math.min(anchor.left - 8, container.width - width - gap)),
    top: Math.max(
      gap,
      Math.min(anchor.top - 8, container.height - Math.min(height, maxHeight) - gap),
    ),
    width,
    maxHeight,
  };
}
