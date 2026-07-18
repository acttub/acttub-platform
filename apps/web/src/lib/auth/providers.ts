import { login } from "../api/v2/auth";
import type { TokenPairResponse } from "../api/v2/types";
import { AUTH_PROVIDER } from "../config/env";

export interface LoginProvider {
  name: "dev" | "google";
  getIdToken(input?: { uid?: string; email?: string }): Promise<string>;
}

export const devProvider: LoginProvider = {
  name: "dev",
  async getIdToken(input) {
    const uid = input?.uid?.trim();
    if (!uid) throw new Error("dev 로그인에는 uid가 필요합니다.");
    const email = input?.email?.trim();
    return email ? `${uid}:${email}` : uid;
  },
};

export const googleProvider: LoginProvider = {
  name: "google",
  async getIdToken() {
    // GIS 연동 시 Google Identity Services에서 받은 credential을 반환한다.
    throw new Error("google login not wired yet (GIS integration pending)");
  },
};

export function getLoginProvider(): LoginProvider {
  return AUTH_PROVIDER === "google" ? googleProvider : devProvider;
}

export async function loginWith(
  provider: LoginProvider,
  input?: { uid?: string; email?: string },
): Promise<TokenPairResponse> {
  return login(provider.name, await provider.getIdToken(input));
}
