import type { SceneContext } from '@/lib/api';
import { getPractice, startPractice } from '@/lib/practice/session-state';
import type { PracticeBlockage, PracticeDetail } from '@/lib/practice/types';

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

const BLOCKAGE: PracticeBlockage = {
  category: '표현',
  detail: '감정',
  note:
    '마지막에 “그럼 나 갈게” 하고 돌아서는 대목이요. 담담하게 참는 얼굴을 하려고 했는데, 막상 보니까 아무 표정도 안 남았어요.',
};

/** 분석까지 지난 상태. 질문 대화 화면이 이 상태를 읽는다. */
export function seedPractice() {
  startPractice({
    practiceId: 'preview-practice',
    rootId: 'preview-practice',
    ordinal: 1,
    scene: SCENE,
    videoUri: '',
    playbackUrl: null,
  });
  const practice = getPractice();
  if (!practice) return;
  practice.conversationId = 'preview-conversation';
}

/**
 * 분석 화면이 미리보기로 곧장 열렸을 때 쓸 값.
 *
 * 딥링크(`actingapp://coach?preview=1`)로 들어오면 회차 id 가 없어서 화면이 준비
 * 화면으로 되돌아간다. 그 경우에만 이 회차를 그려 준다.
 */
export function seedPreviewAnalyzing(): { detail: PracticeDetail } {
  return {
    detail: {
      id: 'preview-practice',
      root_id: 'preview-practice',
      ordinal: 1,
      stage: 'analyzing',
      analysis_status: null,
      job: { id: 'preview-job', status: 'running' },
      video_id: 'preview-video',
      video_purged: false,
      conversation_id: null,
      previous_conversations: [],
      scene: SCENE,
      blockage: BLOCKAGE,
      created_at: new Date().toISOString(),
      playback_url: null,
    },
  };
}
