import { resumeSessionOf } from './redesign-748';
import { fetchSession, listSessions, loadIntoCurrent, setCurrentSession } from './store';

/** 이어 읽기를 연 결과 — play 면 리딩 화면, detail 이면 대본 상세(이을 회차 없음), missing 이면 대본을 못 열었다. */
export type ResumeOpen = 'play' | 'detail' | 'missing';

/**
 * 대본을 현재 대본으로 열고, 멈춘(진행 중) 회차가 있으면 그 회차를 이어 읽을 준비를 한다(SOMA-994).
 * 홈 「이어 읽기」와 리딩 탭 「이어서 읽기」가 같은 길로 열어야 홈에서 새 회차가 처음부터 생기지 않는다.
 * sessionId 를 알면 그 회차를, 모르면 회차 목록에서 진행 중인 것을 고른다.
 */
export async function openResume(scriptId: string, sessionId?: string): Promise<ResumeOpen> {
  const opened = await loadIntoCurrent(scriptId);
  if (!opened) return 'missing';
  const id = sessionId ?? resumeSessionOf(await listSessions(scriptId).catch(() => []))?.id;
  const detail = id ? await fetchSession(id).catch(() => null) : null;
  if (!detail) return 'detail';
  setCurrentSession(detail);
  return 'play';
}
