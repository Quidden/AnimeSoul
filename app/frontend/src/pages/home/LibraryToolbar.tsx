import type { ReactNode } from "react";

export function LibraryToolbar({ summary, children }: { summary: ReactNode; children?: ReactNode }) {
  return (
    <div className="home-list-toolbar">
      <span className="home-list-summary">{summary}</span>
      {children && <div className="home-list-tools">{children}</div>}
    </div>
  );
}
