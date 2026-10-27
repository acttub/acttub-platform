import { fullYearsOn, type ServerProfile } from './profile-form.ts';

/** 입시생이 오디션도 함께 보기 시작하는 만 나이. 이 나이 아래는 입시 일정만 본다. */
export const AUDITION_FROM_AGE = 20;

/**
 * 홈의 마감 임박 두 칸(연기 입시·오디션) 중 무엇을 보일지 프로필로 정한다(SOMA-654).
 * 경력이 입시생이면 입시 일정을, 만 20세 이상 입시생은 오디션도 함께 본다. 그 밖(입시생이 아님·둘러보기·
 * 프로필 미완성)은 오디션만 본다. 입시생인데 생년월일이 없으면 숨기는 쪽보다 둘 다 보이는 쪽을 고른다.
 *
 * @param today 한국 날짜 YYYY-MM-DD(서버의 만 나이 계산과 같은 기준).
 */
export function homeDeadlineSections(
  profile: Pick<ServerProfile, 'experience' | 'birth_date'> | null | undefined,
  today: string,
): { admissions: boolean; auditions: boolean } {
  if (profile?.experience !== 'exam_prep') return { admissions: false, auditions: true };
  if (!profile.birth_date) return { admissions: true, auditions: true };
  return { admissions: true, auditions: fullYearsOn(profile.birth_date, today) >= AUDITION_FROM_AGE };
}

/**
 * 입시생의 실기까지 남은 날(SOMA-864). 입시생이 아니거나, 날짜가 없거나, 지났거나, 400일 넘게 남았으면 null.
 * @param today 한국 날짜 YYYY-MM-DD.
 */
export function examCountdown(
  profile: Pick<ServerProfile, 'experience' | 'exam_date'> | null | undefined,
  today: string,
): number | null {
  if (profile?.experience !== 'exam_prep' || !profile.exam_date) return null;
  const exam = Date.parse(`${profile.exam_date}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(exam) || !Number.isFinite(now)) return null;
  const days = Math.round((exam - now) / 86_400_000);
  return days >= 0 && days <= 400 ? days : null;
}
