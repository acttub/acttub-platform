import { apiFetch } from "./client";

export type DirectVideoSession = {
  id: string;
  status: "preparing" | "replying" | "ready" | "failed" | "finished";
  model: string;
  messages: { role: "user" | "model"; text: string }[];
  error: string | null;
};

const path = "/v2/coach/direct-video";

export async function startDirectVideo(file: File): Promise<DirectVideoSession> {
  const form = new FormData();
  form.set("video", file);
  return (await apiFetch<DirectVideoSession>(path, { method: "POST", body: form })).data;
}

export async function getDirectVideo(id: string, signal: AbortSignal): Promise<DirectVideoSession> {
  return (await apiFetch<DirectVideoSession>(`${path}/${encodeURIComponent(id)}`, { signal })).data;
}

export async function sendDirectVideo(id: string, text: string): Promise<DirectVideoSession> {
  return (await apiFetch<DirectVideoSession>(`${path}/${encodeURIComponent(id)}/messages`, {
    method: "POST", body: { text },
  })).data;
}

export async function deleteDirectVideo(id: string): Promise<void> {
  await apiFetch(`${path}/${encodeURIComponent(id)}`, { method: "DELETE", startGuest: false });
}
