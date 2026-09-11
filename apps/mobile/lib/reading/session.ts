/**
 * 리딩 세션 상태 (SOMA-527) — 화면 간에 파싱된 대본과 내 배역을 넘긴다.
 * v1은 한 번에 한 세션만 다루므로 모듈 싱글턴으로 충분하다(영속화는 다음 단계).
 */
import type { ParsedScript } from './parse';

interface ReadingSession {
  script: ParsedScript;
  myRoles: string[];
}

let current: ReadingSession | null = null;

export function setScript(script: ParsedScript): void {
  current = { script, myRoles: [] };
}

export function getScript(): ParsedScript | null {
  return current?.script ?? null;
}

export function setMyRoles(roles: string[]): void {
  if (current) current.myRoles = roles;
}

export function getMyRoles(): string[] {
  return current?.myRoles ?? [];
}

export function isMyRole(role: string): boolean {
  return (current?.myRoles ?? []).includes(role);
}

export function clear(): void {
  current = null;
}
