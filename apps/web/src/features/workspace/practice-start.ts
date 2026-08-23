import { errorMessage } from "@/lib/api/v2/errors";
import { createPracticeSession } from "@/lib/api/v2/sessions";
import type { PracticeSessionCreateResponse } from "@/lib/api/v2/types";
import {
  UploadError,
  finalizeUpload,
  uploadVideo,
  type S3Uploader,
} from "@/lib/api/v2/uploads";
import type {
  PracticeStartFailurePoint,
  PracticeUploadProfile,
} from "@/lib/analytics/amplitude";
import { hasVideoWebCodecsSupport } from "@/lib/media/compress-video";
import { prepareVideoUpload } from "@/lib/media/upload-preflight";

import type { BlockageSelection } from "../practice/blockage-flow";
import {
  buildPracticeSessionRequest,
  type SceneContextDraft,
} from "../practice/practice-setup-flow";
import type { AnalysisProgressEvent } from "../practice/use-analysis-progress";

import type { PendingVideoUpload } from "./pending-video-upload";

// 연습을 시작하는 길 전체가 이 파일에 있다 — 영상을 다듬어 올리고, 배우가 "시작" 을
// 누른 시점에 그 업로드를 확정하고, 연습 세션을 만드는 데까지. 화면이 무엇으로
// 바뀌는지는 여기서 정하지 않는다(호출부의 몫).

const GENERIC_FAILURE_MESSAGE = "문제가 생겼어요. 다시 시도해 주세요.";

/** "질문 받기"에서 먼저 띄운 압축·업로드가 남기는 것. 막힘 선택이 끝나면 begin 이 이어받는다. */
export type PendingUploadResult = {
  intentId: string;
  durationMs: number;
  compressionRan: boolean;
};

export type PracticeStartFailure = {
  ok: false;
  /**
   * 어디서 엎어졌는지. 사용자에게 보이지는 않고, 어디서 얼마나 깨지는지를 세는
   * 데 쓴다 — 그래서 그 값의 정본은 이것을 받아 적는 amplitude 에 있다.
   */
  stage: PracticeStartFailurePoint;
  /** 배우가 스스로 그만둔 것. 이때는 오류를 띄우지 않는다. */
  aborted: boolean;
  message: string;
  cause: unknown;
};

export type PracticeStartResult =
  | {
    ok: true;
    session: PracticeSessionCreateResponse;
    durationMs: number;
    compressionRan: boolean;
  }
  | PracticeStartFailure;

/**
 * 던져진 것을 실패 결과로 옮긴다. `fallbackStage` 는 예외가 스스로 자리를 말하지
 * 못할 때 쓰는 답이라, 부르는 쪽이 "여기까지는 왔다" 를 알고 있어야 한다.
 */
export function describeStartFailure(
  fallbackStage: PracticeStartFailurePoint,
  cause: unknown,
): PracticeStartFailure {
  return {
    ok: false,
    stage: cause instanceof UploadError ? cause.stage : fallbackStage,
    // UploadError 는 감싼 원인이 중단이면 스스로 이름을 AbortError 로 단다.
    aborted: cause instanceof Error && cause.name === "AbortError",
    message: errorMessage(cause, GENERIC_FAILURE_MESSAGE),
    cause,
  };
}

export type StartVideoUploadOptions = {
  onProgress: (event: AnalysisProgressEvent) => void;
  /**
   * 브라우저에 매인 두 조각 — 압축·길이 재기와 S3 로 올리기. 테스트가 이 길을
   * 걸을 수 있게 갈아 끼울 자리를 둔다(`uploadVideo` 가 이미 뒤엣것을 열어 뒀다).
   */
  prepare?: typeof prepareVideoUpload;
  uploader?: S3Uploader;
  /**
   * 압축·업로드 실측이 나오면 받는다(SOMA-381). 업로드가 끝난 순간 부른다 —
   * 막힘 선택을 하다 그만둬도 이 구간의 숫자는 이미 잰 것이라 남긴다.
   */
  onProfile?: (profile: PracticeUploadProfile) => void;
  /** 계측용 시계. 테스트가 갈아 끼운다. */
  now?: () => number;
};

/**
 * 압축·업로드는 "질문 받기"를 누른 순간 시작해서 막힘을 고르는 동안 뒤에서 돈다.
 * 막힘 선택이 끝난 뒤에 시작하면 배우는 고르는 시간과 올리는 시간을 더해서 기다린다.
 */
export function startVideoUpload(
  file: File,
  {
    onProgress,
    prepare = prepareVideoUpload,
    uploader,
    onProfile,
    now = () => Date.now(),
  }: StartVideoUploadOptions,
): PendingVideoUpload<PendingUploadResult> {
  const controller = new AbortController();
  onProgress({ type: "reset" });
  const promise = (async (): Promise<PendingUploadResult> => {
    // 압축이 "돌았는지"로 구간을 가른다. prepared.wasCompressed 는 결과물을 썼는지라
    // 압축을 다 돌리고도 원본보다 크면 false 가 되고, 그러면 막대가 이미 40까지
    // 올라간 채 업로드 구간이 0부터 시작해 40에서 한참 멈춰 있게 된다.
    let compressionRan = false;
    const prepared = await prepare(file, {
      signal: controller.signal,
      onCompressionProgress: (progress) => {
        compressionRan = true;
        onProgress({ type: "compress", ratio: progress });
      },
    });
    const uploadStartedAt = now();
    const { intentId } = await uploadVideo(prepared.file, {
      durationMs: prepared.durationMs,
      signal: controller.signal,
      uploader,
      // 완료 처리는 startPractice 로 미룬다 — 막힘을 고르다 그만두면 완료된 인텐트는
      // 만료 스윕이 회수하지 않아 세션 없는 영상이 S3 에 남는다.
      finalize: false,
      onProgress: (progress) =>
        onProgress({
          type: "upload",
          percent: progress.percent,
          compressed: compressionRan,
        }),
    });
    onProfile?.({
      compressMs: prepared.compressMs,
      uploadMs: Math.max(0, Math.round(now() - uploadStartedAt)),
      originalBytes: file.size,
      uploadedBytes: prepared.file.size,
      wasCompressed: prepared.wasCompressed,
      webcodecsSupported: hasVideoWebCodecsSupport(),
      videoDurationMs: prepared.durationMs,
    });
    return { intentId, durationMs: prepared.durationMs, compressionRan };
  })();
  // 막힘을 고르는 동안 실패하면 이 약속을 아무도 안 받고 있다 — 여기서 삼켜
  // unhandled rejection 을 막고, 오류 처리는 startPractice 가 await 할 때 한 번만 한다.
  promise.catch(() => undefined);
  return { file, controller, promise };
}

export type StartPracticeInput = {
  /** 먼저 띄워 둔 업로드. `startVideoUpload` 가 돌려준 그 약속이다. */
  upload: Promise<PendingUploadResult>;
  signal: AbortSignal;
  scene: SceneContextDraft;
  blockage: BlockageSelection;
  /** 끝난 연습에서 "이어서 새 연습" 으로 왔다면 그 연습. */
  continueFromId?: string;
};

/**
 * 먼저 띄운 업로드를 이어받아 연습 세션까지 만든다. 실패를 던지지 않고 결과로
 * 돌려주는 이유는 어디서 엎어졌는지가 분기 하나로 갈리기 때문이다 — 예외로 두면
 * 그것을 가르는 일이 `catch` 안에서만 살고, 여기서는 함수를 불러 확인할 수 있다.
 */
export async function startPractice({
  upload,
  signal,
  scene,
  blockage,
  continueFromId,
}: StartPracticeInput): Promise<PracticeStartResult> {
  let stage: PracticeStartFailurePoint = "preflight";
  try {
    const { intentId, durationMs, compressionRan } = await upload;
    // 배우가 연습을 시작하겠다고 한 지금에서야 업로드를 확정한다.
    await finalizeUpload(intentId, { signal });
    stage = "session_create";
    const { session } = await createPracticeSession(
      buildPracticeSessionRequest(intentId, scene, blockage, continueFromId),
      { signal },
    );
    return { ok: true, session, durationMs, compressionRan };
  } catch (cause) {
    return describeStartFailure(stage, cause);
  }
}
