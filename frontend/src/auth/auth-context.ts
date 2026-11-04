import { createContext } from "react";
import type { Account } from "../lib/auth-api";

export type AuthContextValue = {
  account: Account | null;
  loggedOut: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (
    username: string,
    email: string,
    password: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  changeAvatar: (avatarId: string) => Promise<void>;
  changeUsername: (username: string) => Promise<void>;
};

export const AuthContext = createContext<
  AuthContextValue | undefined
>(undefined);
