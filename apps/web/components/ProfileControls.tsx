"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Account, PublicProfile } from "@animesoul/contracts";
import { AccountRequestError, loadAccount } from "../lib/account-client";
import { SocialActions } from "./SocialActions";

export function ProfileControls({
  profile,
  onOwnerChange,
}: {
  profile: PublicProfile;
  onOwnerChange: (owner: boolean) => void;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    onOwnerChange(ready && !error && account?.id === profile.id);
  }, [ready, error, account?.id, profile.id, onOwnerChange]);
  useEffect(() => {
    let active = true;
    let version = 0;
    const refresh = () => {
      const current = ++version;
      void loadAccount()
        .then((value) => {
          if (active && current === version) {
            setAccount(value);
            setError(false);
          }
        })
        .catch((e) => {
          if (active && current === version) {
            setAccount(null);
            setError(!(e instanceof AccountRequestError && e.status === 401));
          }
        })
        .finally(() => {
          if (active && current === version) setReady(true);
        });
    };
    refresh();
    window.addEventListener("animesoul:account-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("animesoul:account-changed", refresh);
    };
  }, [revision]);
  if (!ready)
    return (
      <p className="profile-controls-notice" role="status">
        Проверяем доступ…
      </p>
    );
  if (error)
    return (
      <div className="profile-social-actions">
        <p role="status">Не удалось проверить доступ.</p>
        <button type="button" className="outline" onClick={() => setRevision((value) => value + 1)}>
          Повторить
        </button>
      </div>
    );
  if (!account)
    return (
      <div className="profile-social-actions">
        <Link className="outline" href="/account">
          Войти, чтобы добавить в друзья
        </Link>
      </div>
    );
  if (account.id !== profile.id)
    return (
      <SocialActions key={account.id + ":" + profile.id} account={account} targetId={profile.id} />
    );
  return (
    <div className="profile-owner-controls">
      <div className="profile-social-actions">
        <Link className="outline" href="/library">
          Моя библиотека
        </Link>
        <Link className="outline" href="/friends">
          Мои друзья
        </Link>
      </div>
    </div>
  );
}
