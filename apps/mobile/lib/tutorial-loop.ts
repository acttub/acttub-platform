import { Asset } from 'expo-asset';

import { api } from '@/lib/api';
import { createSampleLoop, isSamplePracticeId, type LoopApi } from '@/lib/tutorial-sample';

/**
 * 연습 루프 화면이 코치·노트를 부를 곳을 고른다 (SOMA-494).
 *
 * <p>예시 회차면 미리 써 둔 코치, 아니면 실제 서버. 연습 id 로 가리므로 튜토리얼이 아닌
 * 연습에서는 {@code api} 와 똑같다. 테스트할 수 있는 부분은 {@code lib/tutorial-sample} 에 있다 —
 * 이 파일은 네이티브 모듈(expo-asset)을 불러 node 테스트에서 못 읽는다.
 */
const sampleLoop = createSampleLoop();

export function loopApiFor(practiceId: string | null | undefined): LoopApi {
  return isSamplePracticeId(practiceId) ? sampleLoop : api;
}

/**
 * 번들에 든 예시 영상의 재생 주소.
 *
 * <p>TODO(SOMA-494): 지금은 개발용 색 막대 영상을 복사해 자리만 채웠다. 배포 전에 권리가
 * 확인된 실제 연기 영상으로 {@code assets/tutorial/sample-scene.mp4} 를 바꿔야 한다.
 */
const SAMPLE_VIDEO = require('@/assets/tutorial/sample-scene.mp4');

export function sampleVideoUri(): string {
  return Asset.fromModule(SAMPLE_VIDEO).uri;
}
