import { translate } from './i18n.ts';

export type CancelVocabulary = 'cancel-local' | 'detach';

export class OperationInactiveError extends Error {
  constructor() {
    super('분석 작업이 더 이상 active가 아닙니다.');
    this.name = 'OperationInactiveError';
  }
}

export class AnalysisTerminalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AnalysisTerminalError';
    this.code = code;
  }
}

export class AnalysisFailedError extends Error {
  readonly code: string | null;

  constructor(code: string | null, message: string) {
    super(message);
    this.name = 'AnalysisFailedError';
    this.code = code;
  }
}

type CancelResource = () => void | Promise<void>;
const DEFAULT_CANCEL_DEADLINE_MS = 2_000;

/** 상태 폴링이 연속으로 이만큼 실패해야 진짜 실패로 친다(백그라운드 복귀 직후 1~2회는 정상). */
export const STATUS_POLL_MAX_FAILURES = 3;

type PendingRecord = {
  schemaVersion: number;
  owner: string;
  session_id: string;
};

export type AnalysisPendingHandle = {
  key: string;
  record: PendingRecord;
};

export class AnalysisOperation {
  readonly generation: number;
  readonly storageScope: string;
  readonly signal: AbortSignal;
  sessionId: string | null = null;
  pendingHandle: AnalysisPendingHandle | null = null;
  private readonly owner: AnalysisOperationOwner;
  private readonly controller = new AbortController();
  private phase: 'pre-session' | 'post-session' = 'pre-session';
  private compressionCancel: CancelResource | null = null;
  private uploadCancel: CancelResource | null = null;

  constructor(
    owner: AnalysisOperationOwner,
    generation: number,
    storageScope: string,
  ) {
    this.owner = owner;
    this.generation = generation;
    this.storageScope = storageScope;
    this.signal = this.controller.signal;
  }

  isActive(): boolean {
    return this.owner.isActive(this);
  }

  checkpoint(): void {
    if (!this.isActive() || this.signal.aborted) throw new OperationInactiveError();
  }

  runIfActive(effect: () => void): boolean {
    if (!this.isActive()) return false;
    effect();
    return true;
  }

  attachCompressionCancel(cancel: CancelResource): void {
    if (!this.isActive()) {
      void Promise.resolve(cancel()).catch(() => undefined);
      return;
    }
    this.compressionCancel = cancel;
  }

  clearCompressionCancel(): void {
    this.compressionCancel = null;
  }

  attachUploadCancel(cancel: CancelResource): void {
    if (!this.isActive()) {
      void Promise.resolve(cancel()).catch(() => undefined);
      return;
    }
    this.uploadCancel = cancel;
  }

  clearUploadCancel(): void {
    this.uploadCancel = null;
  }

  markSessionCreated(sessionId: string): void {
    this.checkpoint();
    this.sessionId = sessionId;
    this.phase = 'post-session';
  }

  setPendingHandle(handle: AnalysisPendingHandle | null): void {
    this.pendingHandle = handle;
  }

  cancellationMode(): CancelVocabulary {
    return this.phase === 'pre-session' ? 'cancel-local' : 'detach';
  }

  deactivate(): void {
    if (!this.controller.signal.aborted) {
      this.controller.abort(new OperationInactiveError());
    }
  }

  async cancelLocalResources(): Promise<void> {
    const resources = [this.compressionCancel, this.uploadCancel].filter(
      (cancel): cancel is CancelResource => cancel !== null,
    );
    this.compressionCancel = null;
    this.uploadCancel = null;
    await Promise.all(
      resources.map((cancel) =>
        Promise.resolve()
          .then(cancel)
          .catch(() => undefined),
      ),
    );
  }
}

export type AnalysisOperationOwnerOptions = {
  now?: () => number;
  instanceId?: string;
  cancelDeadlineMs?: number;
};

export class AnalysisOperationOwner {
  private active: AnalysisOperation | null = null;
  private releasing: AnalysisOperation | null = null;
  private readonly availabilityListeners = new Set<() => void>();
  private generation = 0;
  private readonly now: () => number;
  private readonly instanceId: string;
  private readonly cancelDeadlineMs: number;

  constructor(options: AnalysisOperationOwnerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.instanceId =
      options.instanceId ??
      `${Math.floor(Math.random() * 0x100000000).toString(16)}-${Date.now()}`;
    this.cancelDeadlineMs =
      options.cancelDeadlineMs ?? DEFAULT_CANCEL_DEADLINE_MS;
  }

  start(): AnalysisOperation | null {
    if (this.active || this.releasing) return null;
    this.generation += 1;
    const timestamp = String(this.now()).padStart(16, '0');
    const generation = String(this.generation).padStart(10, '0');
    const storageScope = `${timestamp}-${this.instanceId}-${generation}`;
    const operation = new AnalysisOperation(this, this.generation, storageScope);
    this.active = operation;
    return operation;
  }

  isActive(operation: AnalysisOperation): boolean {
    return this.active === operation;
  }

  onAvailable(listener: () => void): () => void {
    if (!this.active && !this.releasing) {
      let subscribed = true;
      void Promise.resolve().then(() => {
        if (subscribed) listener();
      });
      return () => {
        subscribed = false;
      };
    }
    this.availabilityListeners.add(listener);
    return () => this.availabilityListeners.delete(listener);
  }

  private notifyAvailable(): void {
    const listeners = [...this.availabilityListeners];
    this.availabilityListeners.clear();
    for (const listener of listeners) listener();
  }

  finish(operation: AnalysisOperation): void {
    if (this.active !== operation) return;
    this.active = null;
    this.notifyAvailable();
  }

  private async cancelWithinDeadline(operation: AnalysisOperation): Promise<void> {
    let deadline: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        operation.cancelLocalResources(),
        new Promise<void>((resolve) => {
          deadline = setTimeout(resolve, this.cancelDeadlineMs);
        }),
      ]);
    } finally {
      if (deadline !== null) clearTimeout(deadline);
    }
  }

  async leave(operation: AnalysisOperation): Promise<CancelVocabulary | null> {
    if (this.active !== operation) return null;
    const mode = operation.cancellationMode();
    this.active = null;
    this.releasing = operation;
    operation.deactivate();
    try {
      if (mode === 'cancel-local') await this.cancelWithinDeadline(operation);
    } finally {
      if (this.releasing === operation) {
        this.releasing = null;
        this.notifyAvailable();
      }
    }
    return mode;
  }
}

export function createAnalysisOperationOwner(
  options: AnalysisOperationOwnerOptions = {},
): AnalysisOperationOwner {
  return new AnalysisOperationOwner(options);
}

/** 화면 인스턴스가 여러 개 생겨도 앱 전체에서 분석 pipeline은 하나만 실행한다. */
export const appAnalysisOperationOwner = createAnalysisOperationOwner();

export type AbandonDependencies = {
  deleteSession: (sessionId: string) => Promise<void>;
  removePending: (handle: AnalysisPendingHandle) => Promise<void>;
};

export async function abandonAnalysis(
  sessionId: string | null,
  pendingHandle: AnalysisPendingHandle | null,
  dependencies: AbandonDependencies,
): Promise<'abandon'> {
  if (sessionId) {
    try {
      await dependencies.deleteSession(sessionId);
    } catch (error) {
      if (errorStatus(error) !== 404) throw error;
    }
  }
  if (pendingHandle) await dependencies.removePending(pendingHandle);
  return 'abandon';
}

export type AnalysisSessionStatus = 'analyzing' | 'analyzed' | 'failed';

export type AnalysisStatusPayload = {
  status: AnalysisSessionStatus;
  error_code?: string | null;
};

export type AnalysisDetail = {
  session_id: string;
  status: AnalysisSessionStatus;
  situation: string;
  character_context: string;
  goal: string;
  created_at: string;
  updated_at: string;
  playback_url?: string;
  summary?: { summary_id: string } | null;
};

export type ExistingSessionDependencies = {
  getStatus: (
    sessionId: string,
    signal: AbortSignal,
  ) => Promise<AnalysisStatusPayload>;
  reanalyze: (
    sessionId: string,
    signal: AbortSignal,
  ) => Promise<{ session_id: string; status: AnalysisSessionStatus }>;
};

function failedMessage(code?: string | null): string {
  switch (code) {
    case 'gemini_timeout':
    case 'max_attempts_exceeded':
      return translate('analysis.timeout');
    case 'unsupported_media':
      return translate('analysis.badFormat');
    case 'gemini_parse_error':
      return translate('analysis.summarizeFail');
    default:
      return translate('analysis.failed');
  }
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function errorStatus(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export async function prepareSessionForPolling(
  operation: AnalysisOperation,
  sessionId: string,
  retryFailed: boolean,
  dependencies: ExistingSessionDependencies,
): Promise<AnalysisStatusPayload> {
  operation.checkpoint();
  const current = await dependencies.getStatus(sessionId, operation.signal);
  operation.checkpoint();
  if (current.status !== 'failed') return current;
  if (!retryFailed) {
    throw new AnalysisFailedError(current.error_code ?? null, failedMessage(current.error_code));
  }
  try {
    await dependencies.reanalyze(sessionId, operation.signal);
  } catch (error) {
    operation.checkpoint();
    if (errorCode(error) === 'analysis_retry_exhausted') {
      throw new AnalysisTerminalError(
        'analysis_retry_exhausted',
        translate('analysis.retryExhausted'),
      );
    }
    throw error;
  }
  operation.checkpoint();
  return { status: 'analyzing', error_code: null };
}

export type AnalyzedDetailDependencies = {
  getDetail: (sessionId: string, signal: AbortSignal) => Promise<AnalysisDetail>;
  delay: (delayMs: number, signal: AbortSignal) => Promise<void>;
  retryDelayMs: number;
};

function isCompleteDetail(detail: AnalysisDetail): boolean {
  return Boolean(detail.summary?.summary_id && detail.playback_url);
}

export async function readAnalyzedDetail(
  operation: AnalysisOperation,
  sessionId: string,
  dependencies: AnalyzedDetailDependencies,
): Promise<AnalysisDetail> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    operation.checkpoint();
    const detail = await dependencies.getDetail(sessionId, operation.signal);
    operation.checkpoint();
    if (isCompleteDetail(detail)) return detail;
    if (attempt === 0) {
      await dependencies.delay(dependencies.retryDelayMs, operation.signal);
      operation.checkpoint();
    }
  }
  throw new AnalysisTerminalError(
    'incomplete_analysis',
    translate('analysis.partial'),
  );
}

export type AnalysisUpload = {
  scene: {
    situation: string;
    character: string;
    goal: string;
  };
  /** 이어서 연습 — 없으면 코치가 가장 최근 대화를 이어받는다(서버 기본). */
  continuedFrom?: string | null;
  /**
   * 배우가 고른 막히는 지점. 서버가 이 값으로 분석 코치와 표현 코치를 가른다.
   *
   * 이어받은 분석(앱을 껐다 켠 뒤 등)에는 없을 수 있어 null 을 허용하고, 그때는
   * 서버 기본값('그 외')으로 보낸다.
   */
  blockage: {
    blockage_kind: string;
    sub_branch: string;
    blockage_detail: string | null;
  } | null;
  video: {
    uri: string;
    name: string;
    mimeType: string;
  };
  durationMs: number | null;
};

export type CompressionOutcome =
  | {
      kind: 'completed';
      uri: string;
      originalBytes: number | null;
      compressedBytes: number | null;
    }
  | { kind: 'cancelled' };

export type UploadOutcome = { kind: 'uploaded' } | { kind: 'cancelled' };

export type AnalysisPipelineDependencies = ExistingSessionDependencies & {
  compress: (
    upload: AnalysisUpload,
    operation: AnalysisOperation,
  ) => Promise<CompressionOutcome>;
  getFileSize: (uri: string) => Promise<number>;
  createUploadIntent: (
    input: {
      mime_type: string;
      size_bytes: number;
      duration_ms: number | null;
    },
    signal: AbortSignal,
  ) => Promise<{ intent_id: string; upload_url: string }>;
  uploadToUrl: (
    uploadUrl: string,
    fileUri: string,
    mimeType: string,
    operation: AnalysisOperation,
  ) => Promise<UploadOutcome>;
  completeUpload: (intentId: string, signal: AbortSignal) => Promise<void>;
  createPracticeSession: (
    input: {
      upload_intent_id: string;
      scene: AnalysisUpload['scene'];
      blockage: NonNullable<AnalysisUpload['blockage']>;
      continued_from: string | null;
    },
    signal: AbortSignal,
  ) => Promise<{ session_id: string; status: AnalysisSessionStatus }>;
  getDetail: (sessionId: string, signal: AbortSignal) => Promise<AnalysisDetail>;
  savePending: (
    record: PendingRecord,
    storageScope: string,
  ) => Promise<AnalysisPendingHandle>;
  removePending: (handle: AnalysisPendingHandle) => Promise<void>;
  delay: (delayMs: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
};

export type RunAnalysisPipelineInput = {
  operation: AnalysisOperation;
  ownerId: string;
  upload: AnalysisUpload | null;
  recovered: AnalysisPendingHandle | null;
  existingSessionId?: string | null;
  retryFailed: boolean;
  dependencies: AnalysisPipelineDependencies;
};

export type AnalysisPipelineResult = {
  sessionId: string;
  detail: AnalysisDetail;
};

async function discardPending(
  operation: AnalysisOperation,
  dependencies: AnalysisPipelineDependencies,
): Promise<void> {
  const handle = operation.pendingHandle;
  if (!handle) return;
  operation.checkpoint();
  await dependencies.removePending(handle);
  operation.setPendingHandle(null);
  operation.checkpoint();
}

export async function runAnalysisPipeline({
  operation,
  ownerId,
  upload,
  recovered,
  existingSessionId = null,
  retryFailed,
  dependencies,
}: RunAnalysisPipelineInput): Promise<AnalysisPipelineResult> {
  try {
    let sessionId: string;
    if (recovered || existingSessionId) {
      sessionId = recovered?.record.session_id ?? existingSessionId as string;
      operation.markSessionCreated(sessionId);
      operation.setPendingHandle(recovered);
    } else {
      if (!upload) throw new Error(translate('analysis.noUpload'));
      operation.checkpoint();
      const compressed = await dependencies.compress(upload, operation);
      operation.clearCompressionCancel();
      if (compressed.kind === 'cancelled') throw new OperationInactiveError();
      operation.checkpoint();
      const sizeBytes =
        compressed.compressedBytes ?? (await dependencies.getFileSize(compressed.uri));
      operation.checkpoint();
      const mimeType =
        compressed.uri === upload.video.uri ? upload.video.mimeType : 'video/mp4';
      const intent = await dependencies.createUploadIntent(
        {
          mime_type: mimeType,
          size_bytes: sizeBytes,
          duration_ms: upload.durationMs,
        },
        operation.signal,
      );
      operation.checkpoint();
      const uploaded = await dependencies.uploadToUrl(
        intent.upload_url,
        compressed.uri,
        mimeType,
        operation,
      );
      operation.clearUploadCancel();
      if (uploaded.kind === 'cancelled') throw new OperationInactiveError();
      operation.checkpoint();
      await dependencies.completeUpload(intent.intent_id, operation.signal);
      operation.checkpoint();
      const created = await dependencies.createPracticeSession(
        {
          upload_intent_id: intent.intent_id,
          scene: upload.scene,
          continued_from: upload.continuedFrom ?? null,
          // 고르지 않고 이어받은 분석은 서버 기본값으로 떨어뜨린다.
          blockage: upload.blockage ?? {
            blockage_kind: '그 외',
            sub_branch: '그 외',
            blockage_detail: null,
          },
        },
        operation.signal,
      );
      operation.checkpoint();
      sessionId = created.session_id;
      operation.markSessionCreated(sessionId);
      const handle = await dependencies.savePending(
        {
          schemaVersion: 1,
          owner: ownerId,
          session_id: sessionId,
        },
        operation.storageScope,
      );
      operation.setPendingHandle(handle);
      operation.checkpoint();
    }

    let status = await prepareSessionForPolling(
      operation,
      sessionId,
      retryFailed,
      dependencies,
    );
    const deadline = dependencies.now() + dependencies.pollTimeoutMs;
    // iOS가 백그라운드에서 앱을 얼리면 진행 중이던 상태 조회가 끊긴 채 복귀한다.
    // 그 한 번의 실패로 전체를 죽이지 않도록, 연속 실패만 센다.
    let statusFailures = 0;
    while (status.status !== 'analyzed') {
      if (status.status === 'failed') {
        throw new AnalysisFailedError(
          status.error_code ?? null,
          failedMessage(status.error_code),
        );
      }
      await dependencies.delay(dependencies.pollIntervalMs, operation.signal);
      operation.checkpoint();
      try {
        status = await dependencies.getStatus(sessionId, operation.signal);
        statusFailures = 0;
      } catch (error) {
        operation.checkpoint();
        // 404(세션 삭제)는 바깥의 stale_session 처리로 보낸다.
        if (errorStatus(error) === 404) throw error;
        statusFailures += 1;
        if (statusFailures >= STATUS_POLL_MAX_FAILURES) throw error;
        continue;
      }
      operation.checkpoint();
      // 타임아웃 판정은 방금 받아온 상태 뒤에 한다 — 오래 얼었다 깨어난 직후,
      // 이미 끝난 분석을 확인도 안 해보고 시간 초과로 끝내면 안 된다.
      if (status.status !== 'analyzed' && dependencies.now() >= deadline) {
        throw new Error(translate('analysis.tookTooLong'));
      }
    }
    const detail = await readAnalyzedDetail(operation, sessionId, {
      getDetail: dependencies.getDetail,
      delay: dependencies.delay,
      retryDelayMs: dependencies.pollIntervalMs,
    });
    await discardPending(operation, dependencies);
    return { sessionId, detail };
  } catch (error) {
    if (errorStatus(error) === 404) {
      await discardPending(operation, dependencies);
      throw new AnalysisTerminalError(
        'stale_session',
        translate('analysis.deleted'),
      );
    }
    if (error instanceof AnalysisTerminalError) {
      await discardPending(operation, dependencies);
    }
    throw error;
  }
}
