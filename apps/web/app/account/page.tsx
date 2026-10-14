import type { Metadata } from "next";
import { AccountPanel } from "../../components/AccountPanel";
export const metadata: Metadata = { title: "Аккаунт", robots: { index: false, follow: false } };
export default function AccountPage() {
  return (
    <div className="account-page account-route">
      <AccountPanel />
    </div>
  );
}
