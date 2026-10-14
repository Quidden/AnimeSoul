import Link from "next/link";
export default function ProfileNotFound() {
  return (
    <div className="user-profile-page">
      <div className="profile-main profile-route-state">
        <h1>Профиль недоступен</h1>
        <p>Проверьте имя в адресе. Профиль мог стать приватным или доступным только друзьям.</p>
        <div className="profile-state-actions">
          <Link className="primary" href="/account">
            Войти в аккаунт
          </Link>
          <Link className="outline" href="/community">
            Сообщество
          </Link>
        </div>
      </div>
    </div>
  );
}
