import { createContext, useContext } from "react";

export type AccountUser = {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  avatar: string;
  presence?: "online" | "offline" | "dnd" | "invisible";
  hasPassword: boolean;
  googleLinked: boolean;
  roles: { id: string; name: string }[];
  permissions: string[];
};

export type AccountConfig = { website: boolean; google: boolean; email: boolean; giphyKey?: string };
export type AccountContextValue = {
  config: AccountConfig;
  user: AccountUser | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

export const AccountContext = createContext<AccountContextValue>({
  config: { website: false, google: false, email: false },
  user: null,
  refresh: async () => undefined,
  logout: async () => undefined,
});
export function useAccount() { return useContext(AccountContext); }
