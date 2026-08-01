import { apiFetch } from "./client";
import type { components } from "../v2-schema";

export type Me = components["schemas"]["MeResponse"];

export const NICKNAME_MAX_LENGTH = 20;

export async function getMe(options: { signal?: AbortSignal } = {}) {
  const { data } = await apiFetch<Me>("/v2/me", { signal: options.signal });
  return data;
}

export async function updateNickname(nickname: string) {
  const { data } = await apiFetch<Me>("/v2/me", {
    method: "PATCH",
    body: { nickname },
  });
  return data;
}
