import type { ExpressionReport, SceneContext } from '@/lib/api';
import { setPendingUpload, startPractice, getPractice } from '@/lib/practice';
import type { BlockageSelection } from '@/lib/api';

/**
 * 화면만 보기 위한 가짜 데이터.
 *
 * 연습 화면들은 영상 업로드 → Gemini 분석을 지나야 나온다. 배치·문구·간격만 고칠
 * 때마다 그 몇 분을 매번 기다릴 수 없어서, 개발 빌드에서만 열리는 통로를 둔다.
 *
 * **`__DEV__` 밖에서는 절대 부르지 않는다.** 화면(app/ui-preview.tsx)이 그 가드를
 * 들고 있고, 이 파일은 순수 데이터라 배포 번들에 들어가도 실행되지 않는다.
 */

const SCENE: SceneContext = {
  situation: '이별을 통보받은 직후, 카페에서',
  character: '담담한 척하는 20대 후반 여성',
  goal: '상대가 마음을 돌려 다시 앉게 만들기',
};

const BLOCKAGE: BlockageSelection = {
  blockage_kind: '표현',
  sub_branch: '감정',
  blockage_detail:
    '마지막에 “그럼 나 갈게” 하고 돌아서는 대목이요. 담담하게 참는 얼굴을 하려고 했는데, 막상 보니까 아무 표정도 안 남았어요.',
};

const TURNS = [
  { role: 'ai' as const, text: '목을 조이던 그 순간, 눈은 어디에 가 있었나요?' },
  { role: 'actor' as const, text: '상대 얼굴에서 눈을 못 떼고 계속 보고 있었어요.' },
  { role: 'ai' as const, text: '계속 보고 있었을 때, 상대에게서 무엇을 기다리고 있었나요?' },
  { role: 'actor' as const, text: '먼저 미안하다고 말해주길 기다렸던 것 같아요.' },
  { role: 'ai' as const, text: '그 기다림이 얼굴에서는 어떻게 나갔을까요?' },
];

const REPORT: ExpressionReport = {
  report_type: 'expression',
  title: '확신보다 확인을 원했다',
  blocked_point:
    '말을 끝낸 뒤 시선이 아래로 내려가는 구간이에요. 대화를 닫으려는 몸짓이 먼저 나와서, 참고 있다는 것이 얼굴에는 남지 않았어요.',
  expression_core: '참는 얼굴을 만들려 하기보다, 상대의 답을 기다리는 시간을 두는 쪽이 가까워요.',
  line_meaning: '“그럼 나 갈게”는 떠나겠다는 통보가 아니라, 붙잡아 달라는 마지막 확인이에요.',
  timing_reason: '상대가 아무 말도 하지 않은 직후라, 기다림이 가장 길어지는 자리예요.',
  playable_action: '대답을 재촉하지 않고, 상대가 입을 열 틈을 남긴다.',
  effective_experiment: {
    instruction: '대답하기 전에 2초를 더 듣고, 그 뒤에 시선을 든다.',
    tested: true,
  },
  observed_change: '2초를 두었을 때 참는 얼굴을 만들지 않아도 기다림이 그대로 보였어요.',
  next_take: '대답하기 전에 2초를 더 듣고, 그 뒤에 시선을 든다.',
  acting_trap: '감정을 얼굴로 밀어 올리려 하면 다시 굳어요. 기다리는 일에만 머무르세요.',
  actor_training: {
    title: '기다림 2초 두기',
    purpose: '표정을 만들지 않고도 기다림이 보이게 한다',
    duration_minutes: 5,
    steps: ['상대 대사를 듣고 속으로 둘을 센다', '센 뒤에 시선을 든다', '표정은 손대지 않는다'],
    focus: '세는 동안 얼굴에 힘을 주지 않는다',
    success_check: '2초 뒤 시선이 자연히 올라가는지',
    tested: false,
  },
  evidence: ['0:41 — 말을 끝낸 직후 시선이 먼저 내려간다', '0:44 — 어깨가 돌아가며 대화가 닫힌다'],
  actor_words: [
    '“상대가 먼저 미안하다고 말해주길 기다렸는데, 그게 오지 않아서 내가 먼저 돌아섰어요.”',
  ],
  uncertainties: ['소리는 마이크가 멀어 판단하지 않았어요'],
  source_handoff_ids: { analysis: null, expression: 'preview' },
};

/** 업로드 대기물만 채운다 — 막히는 지점 화면부터 보고 싶을 때. */
export function seedPendingUpload(videoUri = '') {
  setPendingUpload({
    scene: SCENE,
    video: { uri: videoUri, name: 'take_03.mov', mimeType: 'video/mp4' },
    durationMs: 72_000,
    blockage: null,
    continuedFrom: null,
  });
}

/** 분석까지 지난 상태. 질문 대화·분석 결과 화면이 이 상태를 읽는다. */
export function seedPractice(options: { withReport?: boolean; withTurns?: boolean } = {}) {
  setPendingUpload({
    scene: SCENE,
    video: { uri: '', name: 'take_03.mov', mimeType: 'video/mp4' },
    durationMs: 72_000,
    blockage: BLOCKAGE,
    continuedFrom: null,
  });
  startPractice({
    practiceSessionId: 'preview-session',
    scene: SCENE,
    videoUri: '',
    playbackUrl: null,
  });
  const practice = getPractice();
  if (!practice) return;
  practice.coachSessionId = 'preview-coach';
  if (options.withTurns) {
    practice.turns = [...TURNS];
    practice.questionCount = TURNS.filter((t) => t.role === 'ai').length;
  }
  if (options.withReport) practice.report = REPORT;
}

export const previewScene = SCENE;
export const previewBlockage = BLOCKAGE;

/**
 * 분석 화면이 미리보기로 곧장 열렸을 때 쓸 값.
 *
 * 딥링크(`actingapp://analyzing?preview=1`)로 들어오면 업로드 대기물이 없어서 화면이
 * 업로드로 되돌아간다. 그 경우에만 이 값을 그려 준다.
 */
export function seedPreviewAnalyzing() {
  return { scene: SCENE, blockage: BLOCKAGE };
}
