import { ApiError, errorMessage } from "@/lib/api/v2/errors";
import { continuePractice, createPractice } from "@/lib/api/v2/practices";
import { UploadError } from "@/lib/api/v2/uploads";
import { uploadLibraryVideo } from "@/lib/api/v2/videos";
import type { S3Uploader } from "@/lib/media/s3-uploader";
import type { Practice } from "@/lib/practice/api-types";
import type {
  PracticeStartFailurePoint,
  PracticeUploadProfile,
} from "@/lib/analytics/amplitude";
import { hasVideoWebCodecsSupport } from "@/lib/media/compress-video";
import { prepareVideoUpload } from "@/lib/media/upload-preflight";
import { newRequestId } from "@/lib/reading/request-id";

import type { BlockageSelection } from "../practice/blockage-flow";
import {
  buildPracticeRequest,
  type SceneContextDraft,
} from "../practice/practice-setup-flow";
import type { AnalysisProgressEvent } from "../practice/use-analysis-progress";

import type { PendingVideoUpload } from "./pending-video-upload";

// 연습을 시작하는 길 전체가 이 파일에 있다 — 영상을 다듬어 보관함에 올리고(확정까지, practice.record),
// 배우가 "시작"을 누른 시점에 그 영상으로 회차를 만드는 데까지(practice.start·resume). 영상 확정과 회차
// 시작은 분리돼 있다 — 회차를 만들다 실패해도 영상은 보관함에 남아 다시 올리지 않는다.
// 화면이 무엇으로 바뀌는지는 여기서 정하지 않는다(호출부의 몫).

const GENERIC_FAILURE_MESSAGE = "문제가 생겼어요. 다시 시도해 주세요.";

/** 올리기가 남기는 것 — 보관함에 확정된 영상. 시작이 이것으로 회차를 만든다. */
export type PendingUploadResult = {
  videoId: string;
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
  /** 묶음에 진행 중 회차가 있다(409 practice_in_progress). 화면은 그 회차로 돌아간다. */
  inProgress: boolean;
  /** 영상은 이미 보관함에 확정됐는데 회차 생성이 엎어졌다 — 다시 시도할 때 다시 올리지 않는다. */
  videoId?: string;
  message: string;
  cause: unknown;
};

export type PracticeStartResult =
  | {
    ok: true;
    practice: Practice;
    /** 시작에 쓴 영상 — 실패 뒤 다시 시도할 때 다시 올리지 않는다 */
    videoId: string;
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
  videoId?: string,
): PracticeStartFailure {
  return {
    ok: false,
    ...(videoId ? { videoId } : {}),
    stage: cause instanceof UploadError ? cause.stage : fallbackStage,
    // UploadError 는 감싼 원인이 중단이면 스스로 이름을 AbortError 로 단다.
    aborted: cause instanceof Error && cause.name === "AbortError",
    inProgress: cause instanceof ApiError && cause.status === 409 && cause.code === "practice_in_progress",
    message: errorMessage(cause, GENERIC_FAILURE_MESSAGE),
    cause,
  };
}

export type StartVideoUploadOptions = {
  onProgress: (event: AnalysisProgressEvent) => void;
  /**
   * 브라우저에 매인 두 조각 — 압축·길이 재기와 S3 로 올리기. 테스트가 이 길을
   * 걸을 수 있게 갈아 끼울 자리를 둔다.
   */
  prepare?: typeof prepareVideoUpload;
  uploader?: S3Uploader;
  /**
   * 압축·업로드 실측이 나오면 받는다(SOMA-381). 업로드가 끝난 순간 부른다 —
   * 시작을 하다 그만둬도 이 구간의 숫자는 이미 잰 것이라 남긴다.
   */
  onProfile?: (profile: PracticeUploadProfile) => void;
  /** 계측용 시계. 테스트가 갈아 끼운다. */
  now?: () => number;
  /** 올리기의 요청 id. 재시도가 같은 값을 쓴다. 없으면 새로 만든다. */
  requestId?: string;
};

/**
 * 영상을 다듬어 보관함에 올린다. 마무리까지 하므로 끝나면 영상은 "보관함 저장"이다 — 회차를 만들지
 * 않아도 보관함에 남는다(practice.record). 같은 파일의 재시도는 같은 요청 id 로 같은 영상을 받는다.
 */
export function startVideoUpload(
  file: File,
  {
    onProgress,
    prepare = prepareVideoUpload,
    uploader,
    onProfile,
    now = () => Date.now(),
    requestId = newRequestId(),
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
    const video = await uploadLibraryVideo(prepared.file, {
      durationMs: prepared.durationMs,
      requestId,
      signal: controller.signal,
      uploader,
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
    return { videoId: video.id, durationMs: prepared.durationMs, compressionRan };
  })();
  // 시작 전에 실패하면 이 약속을 아무도 안 받고 있다 — 여기서 삼켜
  // unhandled rejection 을 막고, 오류 처리는 startPractice 가 await 할 때 한 번만 한다.
  promise.catch(() => undefined);
  return { file, controller, promise };
}

export type StartPracticeInput = {
  /** 먼저 띄워 둔 업로드 또는 보관함 영상. `startVideoUpload` 가 돌려준 그 약속이거나 이미 있는 영상이다. */
  upload: Promise<PendingUploadResult>;
  signal: AbortSignal;
  scene: SceneContextDraft;
  blockage: BlockageSelection;
  /** 끝난 묶음에서 이어할 때 이어받을 회차. 같은 묶음의 다음 차수가 된다. */
  continueFromId?: string;
  /**
   * 이어하기에서 같은 영상을 다시 쓰는가. 그러면 video_id 를 싣지 않는다(서버가 이전 회차의 영상을 쓴다).
   * 새 영상이면 업로드한 영상 id 를 싣는다.
   */
  reuseVideo?: boolean;
  /** 회차 요청 id. 같은 본문에 같은 값을 다시 쓰면 회차가 하나다. */
  requestId: string;
};

/**
 * 먼저 띄운 업로드를 이어받아 회차까지 만든다. 실패를 던지지 않고 결과로
 * 돌려주는 이유는 어디서 엎어졌는지가 분기 하나로 갈리기 때문이다 — 예외로 두면
 * 그것을 가르는 일이 `catch` 안에서만 살고, 여기서는 함수를 불러 확인할 수 있다.
 */
export async function startPractice({
  upload,
  signal,
  scene,
  blockage,
  continueFromId,
  reuseVideo = false,
  requestId,
}: StartPracticeInput): Promise<PracticeStartResult> {
  let stage: PracticeStartFailurePoint = "preflight";
  let savedVideoId: string | undefined;
  try {
    const { videoId, durationMs, compressionRan } = await upload;
    savedVideoId = videoId;
    stage = "session_create";
    const body = buildPracticeRequest(videoId, scene, blockage);
    const { practice } = continueFromId
      ? await continuePractice(
          continueFromId,
          reuseVideo ? { scene: body.scene, blockage: body.blockage } : body,
          { requestId, signal },
        )
      : await createPractice(body, { requestId, signal });
    return { ok: true, practice, videoId, durationMs, compressionRan };
  } catch (cause) {
    return describeStartFailure(stage, cause, savedVideoId);
  }
}
