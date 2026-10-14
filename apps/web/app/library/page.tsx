import type { Metadata } from "next";
import { LibraryPanel } from "../../components/LibraryPanel";
export const metadata: Metadata = {
  title: "Моя библиотека",
  robots: { index: false, follow: false },
};
export default function LibraryPage() {
  return (
    <div className="account-page">
      <LibraryPanel />
    </div>
  );
}
