import { login } from "../api/v2/auth";
import type { TokenPairResponse } from "../api/v2/types";

export interface LoginProvider {
  name: "development" | "google";
  getIdToken(input?: {
    uid?: string;
    email?: string;
    credential?: string;
  }): Promise<string>;
}

export const developmentProvider: LoginProvider = {
  name: "development",
  async getIdToken(input) {
    const uid = input?.uid?.trim();
    if (!uid) throw new Error("development 로그인에는 uid가 필요합니다.");
    const email = input?.email?.trim();
    return email ? `${uid}:${email}` : uid;
  },
};

export const googleProvider: LoginProvider = {
  name: "google",
  async getIdToken(input) {
    if (!input?.credential) {
      throw new Error("Google 로그인 credential이 필요합니다.");
    }
    return input.credential;
  },
};

export async function loginWith(
  provider: LoginProvider,
  input?: { uid?: string; email?: string; credential?: string },
): Promise<TokenPairResponse> {
  return login(provider.name, await provider.getIdToken(input));
}
