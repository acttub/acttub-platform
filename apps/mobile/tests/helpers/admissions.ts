import type { AdmissionNotice, AdmissionsResponse, AdmissionUniversity } from '@/lib/admissions';

export function university(overrides: Partial<AdmissionUniversity> = {}): AdmissionUniversity {
  return {
    id: 'u1',
    name: '한국예술대학교',
    admission_url: 'https://admission.example.ac.kr',
    region: null,
    campus: null,
    type: null,
    note: null,
    resources: [],
    tips: [],
    ...overrides,
  };
}

export function notice(overrides: Partial<AdmissionNotice> = {}): AdmissionNotice {
  return {
    id: 'n1',
    university_id: 'u1',
    designated_works: [],
    essay_questions: [],
    stages: [],
    practical_items: [],
    results: [],
    ...overrides,
  };
}

export function admissions(overrides: Partial<AdmissionsResponse> = {}): AdmissionsResponse {
  return {
    updated_at: '2026-10-01',
    disclaimer: '모집요강을 꼭 직접 확인하세요.',
    universities: [],
    notices: [],
    ...overrides,
  };
}

/** 화면이 쓰는 것과 같은 기기 기준 오늘(YYYY-MM-DD). */
export function todayText(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
