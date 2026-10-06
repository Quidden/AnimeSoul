import { navigateTo } from "../navigation/routes";
import { useAccount } from "./context";
import { useProfileMedia } from "./useProfileMedia";

export function AccountButton({ onNavigate }: { onNavigate?: () => void }) {
  const { config, user } = useAccount();
  const media = useProfileMedia(user?.avatar ?? "");
  if (!config.website) return null;
  return <button type="button" className="account-header-button" onClick={() => {
    onNavigate?.();
    navigateTo("/account");
  }} aria-label={user ? `Профиль ${user.username}` : "Войти в аккаунт"}>
    {media.url ? <img src={media.url} alt="" referrerPolicy="no-referrer" /> : <span className="account-avatar" aria-hidden="true">{user?.username.slice(0, 1).toUpperCase() ?? "◎"}</span>}
    <span>{user?.username ?? "Войти"}</span>
  </button>;
}
