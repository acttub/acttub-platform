/**
 * 회차(practice) 계약 타입 — 1.0.0에서 연습은 묶음의 n차이고, 영상은 보관함의 독립 자산이다.
 *
 * 서버(PA2)가 아직 없어 스펙의 API 표와 요구사항(02-practice practice.start·resume·analyze)을
 * 기준으로 둔다. 통합(PI1)이 생성 타입으로 바꾼다. 경험 판(legacy·three_layers_v1)은 서버가
 * 정하고 앱은 `X-Acttub-Contract: three_layers_v1` 헤더로 알린다(api-request).
 */

/** 회차 진행 상태. 분석 결과의 상태(analysis.status)와 다른 것이다. */
export type PracticeStage = 'analyzing' | 'conversing' | 'closed';

/** 분석 작업(ai_jobs)의 상태. */
export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/** 분석 결과(analyses)의 상태. 부분 실패는 partial로 남고 대화는 시작된다. */
export type AnalysisStatus = 'ready' | 'partial';

/** 막힘 큰 갈래. 고르지 않으면 '그 외'(막힘 미특정)다. */
export type BlockageCategory = '분석' | '표현' | '그 외';

/** 막힘 세부. 표현의 넷과 '그 외'뿐이고 고르지 않으면 '그 외'다. */
export type BlockageDetail = '감정' | '움직임' | '화술' | '표정' | '캐릭터 분석' | '대사 분석' | '그 외';

/** 상황·인물·목표. 셋 다 선택이고 비우면 빈 문자열로 저장된다(시작 뒤 불변). */
export type PracticeScene = {
  situation: string;
  character: string;
  goal: string;
};

export type PracticeBlockage = {
  category: BlockageCategory;
  detail: BlockageDetail;
  note: string | null;
};

export type PracticeJob = {
  id: string;
  status: JobStatus;
  failure_reason?: string | null;
};

/** 시작·이어하기 응답. */
export type Practice = {
  id: string;
  root_id: string;
  ordinal: number;
  stage: PracticeStage;
  analysis_status: AnalysisStatus | null;
  job: PracticeJob;
};

/** 회차 상세(GET /v2/practices/{id}). 코치·노트는 PM3가 쓴다. */
export type PracticeDetail = Practice & {
  video_id: string;
  scene: PracticeScene;
  blockage: PracticeBlockage;
  created_at: string;
  playback_url?: string | null;
};

/** 폴링이 읽는 것(GET /v2/practices/{id}/status). */
export type PracticeStatus = {
  stage: PracticeStage;
  job: { status: JobStatus; failure_reason?: string | null };
  analysis: { status: AnalysisStatus } | null;
};

/** 묶음 목록의 한 줄. 진행 중 회차 id로 복귀시킨다(409의 본문은 코드뿐이다). */
export type PracticeGroup = {
  root_id: string;
  title: string | null;
  ordinal_count: number;
  in_progress_practice_id: string | null;
  favorite: boolean;
  hidden_at: string | null;
  last_practiced_at?: string | null;
};

export type PracticeGroupFilter = 'all' | 'favorite' | 'recent30';

export type CreatePracticeBody = {
  request_id: string;
  video_id: string;
  scene: PracticeScene;
  blockage: PracticeBlockage;
};

/** 이어하기. video_id가 없으면 서버가 이전 회차의 영상을 그대로 쓴다. */
export type ContinuePracticeBody = {
  request_id: string;
  video_id?: string;
  scene: PracticeScene;
  blockage: PracticeBlockage;
};

/** 시작·이어하기·분석이 내는 코드. 본문 코드만 오고 화면이 문구를 고른다. */
export const PRACTICE_ERROR_CODES = [
  'video_not_ready',
  'practice_in_progress',
  'guest_daily_analysis_limit',
  'request_fingerprint_mismatch',
  'analysis_not_ready',
] as const;

export type PracticeErrorCode = (typeof PRACTICE_ERROR_CODES)[number];

/** 분석 작업이 실패한 사유(ai_jobs.failure_reason). 그 밖의 값은 일반 문구로 떨어진다. */
export type AnalysisFailureReason =
  | 'timeout'
  | 'parse'
  | 'unsupported'
  | 'cancelled'
  | 'account_deactivated';
