export function ProfileLibraryLoading() {
  return (
    <div className="profile-loading" aria-busy="true">
      <p role="status">Загружаем библиотеку профиля…</p>
      <div className="profile-loading-section" aria-hidden="true" />
    </div>
  );
}
