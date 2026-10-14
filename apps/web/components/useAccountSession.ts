"use client";
import { useEffect, useState } from "react";
import type { Account } from "@animesoul/contracts";
import { loadAccount } from "../lib/account-client";

export function useAccountSession() {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true,
      version = 0;
    const refresh = () => {
      const current = ++version;
      void loadAccount()
        .catch(() => null)
        .then((value) => {
          if (active && current === version) {
            setAccount(value);
            setReady(true);
          }
        });
    };
    refresh();
    window.addEventListener("animesoul:developer-access-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("animesoul:developer-access-changed", refresh);
    };
  }, []);
  return { account, setAccount, ready };
}
