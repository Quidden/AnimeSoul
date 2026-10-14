import type { Metadata } from "next";
import { FriendsPanel } from "../../components/FriendsPanel";
export const metadata: Metadata = {
  title: "Друзья и подписки",
  robots: { index: false, follow: false },
};
export default function FriendsPage() {
  return (
    <div className="account-page social-page friends-page">
      <header className="friends-heading">
        <h1>Друзья и подписки</h1>
        <p>Общайся с людьми, с которыми хочется делиться любимыми историями.</p>
      </header>
      <FriendsPanel />
    </div>
  );
}
