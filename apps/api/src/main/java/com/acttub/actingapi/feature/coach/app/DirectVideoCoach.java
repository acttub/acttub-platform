package com.acttub.actingapi.feature.coach.app;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.observation.ReplyTrace;
import com.acttub.actingapi.integration.media.FaceMosaic;
import com.acttub.actingapi.integration.media.FaceMosaicRenderer;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmPrompt;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Gemini transport for the existing durable coach API; no layer-one model; response routing is a separate text call. */
public final class DirectVideoCoach {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(DirectVideoCoach.class);
    /** 노트의 다음 촬영에는 행동만 남긴다 — "그 해석이면 ~"의 앞말을 뗀다(dev 시험 10/11). */
    private static final java.util.regex.Pattern READING_LEAD =
            java.util.regex.Pattern.compile("^(?:그|이|말한) ?해석(?:이면|대로라면|대로면|대로)[,]?\\s*");

    private final DirectVideoModel model;
    private final CoachVideoSource videos;
    private final ObjectStorage storage;
    private final FailureReporter failures;
    private final LlmTelemetry telemetry;
    private final DirectVideoRouting routing;
    // 연습 루프로 대화를 끌고 간다. 첫 응답은 연습 루프 프롬프트, 둘째 응답부터는 코드가 할 일을 정한다. 배포가 정한다.
    private final boolean practiceLoop;
    // 자문위원 연습만 코치 성격을 번갈아 받는다(SOMA-622). 그 밖의 배우는 늘 기본 성격이다.
    private final CoachPersonas personas;
    /** 코치 흐름 A/B(SOMA-636). NONE 이면 모두 A(롤백). */
    private final CoachFlows flows;
    private CoachOpenings openings = CoachOpenings.NONE;
    // 리딩 녹음으로 시작한 회차(SOMA-791)의 소리와 대본. 없으면 그 회차는 답하지 못하고 닫힌다.
    private CoachReadingAudio readingAudio = CoachReadingAudio.NONE;
    private CoachPro coachPro = CoachPro.NONE;
    private CoachProMemory proMemory = CoachProMemory.NONE;
    // 코치 모델 비교(SOMA-657). 새 대화의 alternateShare% 는 코치 답을 alternate 모델로 쓴다.
    // 분류·줄이기·영상 올리기는 늘 기본 모델이다. null 이거나 0 이면 모두 기본 모델(롤백).
    private final DirectVideoModel alternate;
    private final int alternateShare;
    /** 한 대화 안에서 올린 영상을 다시 쓴다(SOMA-735). NONE 이면 답마다 올리고 지운다(롤백). */
    private final CoachVideoCache videoCache;
    /**
     * '내려놓기'(배우가 코치 말을 정정한 답)는 영상을 붙이지 않고 글(지시문·대화·상태)만 보내 쓴다(SOMA-780).
     * 이 답만 영상이 붙으면 Gemini 가 글을 내기 전에 생각 루프에 빠져 15~20초 걸렸다(2026-10-21 운영 실측, 10회 중 6회).
     * 영상을 빼면 생각 0·첫 글자 약 1.3초였고 답도 정정을 반영했다. false 면 예전처럼 영상과 함께 쓴다(롤백).
     */
    private final boolean letGoWithoutVideo;
    /**
     * 연습 루프의 답장(첫 질문이 아닌 턴)은 생각 단계를 MINIMAL 로 보낸다(SOMA-780). LOW 에서 가끔 생각 토큰이 약 3,900까지 늘어
     * 빈 답·깨진 글·재시도로 20~28초 걸렸다(2026-10-22 실제 대화 10턴×3회: MINIMAL 은 루프 0회, 중앙값 4.0초·최대 8.8초, 지금은 6.3·23.2초).
     * 첫 질문·분류·정리 노트는 LOW 그대로다. MINIMAL 을 받지 않는 모델은 LOW 로 둔다. false 면 모두 LOW(롤백).
     */
    private final boolean followUpMinimalThinking;
    /** 코칭 1층 관찰 A/B(SOMA-815). NONE 이면 칸이 없다(롤백). */
    static final String LAYER1 = "layer1";
    private final CoachLayerOne layerOne;
    /** 얼굴 가리기 회차(practice.start)의 원본을 가린 사본으로 바꾼다. NONE 이면 그런 회차는 원본을 올리지 않고 실패한다. */
    private FaceMosaic faceMosaic = FaceMosaic.NONE;
    // "이미 그렇게 했다" 처리 비교(SOMA-855). 새 대화의 alreadyShare% 는 한 일 묻기 → 다르게 정리로 간다. 0 이면 모두 대조 쪽(롤백).
    private int alreadyShare = 0;

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop) {
        this(model, videos, storage, failures, telemetry, practiceLoop, CoachPersonas.NONE);
    }

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop, CoachPersonas personas) {
        this(model, videos, storage, failures, telemetry, practiceLoop, personas, null, 0);
    }

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop, CoachPersonas personas,
            DirectVideoModel alternate, int alternateShare) {
        this(model, videos, storage, failures, telemetry, practiceLoop, personas, alternate, alternateShare, CoachFlows.NONE);
    }

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop, CoachPersonas personas,
            DirectVideoModel alternate, int alternateShare, CoachFlows flows) {
        this(model, videos, storage, failures, telemetry, practiceLoop, personas, alternate, alternateShare, flows, CoachVideoCache.NONE);
    }

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop, CoachPersonas personas,
            DirectVideoModel alternate, int alternateShare, CoachFlows flows, CoachVideoCache videoCache) {
        this(model, videos, storage, failures, telemetry, practiceLoop, personas, alternate, alternateShare, flows, videoCache, true);
    }

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop, CoachPersonas personas,
            DirectVideoModel alternate, int alternateShare, CoachFlows flows, CoachVideoCache videoCache,
            boolean letGoWithoutVideo) {
        this(model, videos, storage, failures, telemetry, practiceLoop, personas, alternate, alternateShare, flows, videoCache,
                letGoWithoutVideo, true);
    }

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop, CoachPersonas personas,
            DirectVideoModel alternate, int alternateShare, CoachFlows flows, CoachVideoCache videoCache,
            boolean letGoWithoutVideo, boolean followUpMinimalThinking) {
        this(model, videos, storage, failures, telemetry, practiceLoop, personas, alternate, alternateShare, flows, videoCache,
                letGoWithoutVideo, followUpMinimalThinking, CoachLayerOne.NONE);
    }

    public DirectVideoCoach(DirectVideoModel model, CoachVideoSource videos, ObjectStorage storage,
            FailureReporter failures, LlmTelemetry telemetry, boolean practiceLoop, CoachPersonas personas,
            DirectVideoModel alternate, int alternateShare, CoachFlows flows, CoachVideoCache videoCache,
            boolean letGoWithoutVideo, boolean followUpMinimalThinking, CoachLayerOne layerOne) {
        this.layerOne = layerOne == null ? CoachLayerOne.NONE : layerOne;
        this.followUpMinimalThinking = followUpMinimalThinking;
        this.letGoWithoutVideo = letGoWithoutVideo;
        this.videoCache = videoCache == null ? CoachVideoCache.NONE : videoCache;
        this.flows = flows == null ? CoachFlows.NONE : flows;
        this.alternate = alternate;
        this.alternateShare = alternate == null ? 0 : Math.max(0, Math.min(100, alternateShare));
        this.personas = personas == null ? CoachPersonas.NONE : personas;
        this.practiceLoop = practiceLoop;
        this.model = model;
        this.videos = videos;
        this.storage = storage;
        this.failures = failures;
        this.telemetry = telemetry;
        this.routing = new DirectVideoRouting(model, failures, telemetry::record);
    }

    public boolean practiceLoop() {
        return practiceLoop;
    }

    /** 얼굴 가리기 회차의 사본을 만들 곳을 끼운다. null 이면 만들 수 없는 것으로 본다. */
    /** "이미 그렇게 했다" 처리 비교(SOMA-855)의 실험 쪽 비율(0~100). */
    public DirectVideoCoach withAlreadyShare(int share) {
        this.alreadyShare = Math.max(0, Math.min(100, share));
        return this;
    }

    /** 첫 코칭 첫 말 비교의 배정기를 끼운다. 기본은 {@link CoachOpenings#NONE}(모두 A). */
    public DirectVideoCoach withOpenings(CoachOpenings openings) {
        this.openings = openings == null ? CoachOpenings.NONE : openings;
        return this;
    }

    /** Pro 지난 연습 기억(SOMA-900)을 끼운다. 기본은 모두 무료(기억 칸 없음). */
    public DirectVideoCoach withProMemory(CoachPro pro, CoachProMemory memory) {
        this.coachPro = pro == null ? CoachPro.NONE : pro;
        this.proMemory = memory == null ? CoachProMemory.NONE : memory;
        return this;
    }

    public DirectVideoCoach withFaceMosaic(FaceMosaic faceMosaic) {
        this.faceMosaic = faceMosaic == null ? FaceMosaic.NONE : faceMosaic;
        return this;
    }

    /** 리딩 녹음 코칭(SOMA-791)의 재료를 끼운다. 기본은 없음이다. */
    public DirectVideoCoach withReadingAudio(CoachReadingAudio readingAudio) {
        this.readingAudio = readingAudio == null ? CoachReadingAudio.NONE : readingAudio;
        return this;
    }

    public CoachResult turn(CoachSessionSnapshot session, String actorText, UUID operationId) {
        return turn(session, actorText, operationId, null);
    }

    /**
     * {@code stream} 이 있으면 코치 답을 쓰는 대로 흘려보낸다(코칭 스트리밍, 2026-10-16 사용자 결정 "AI에 맡기고 그대로 흘리기").
     * 이때 배우에게 보이는 말은 다듬지 않는다 — 질문 하나만 남기기·시간 표기 지우기·되풀이·인정 말 떼기·60자 줄이기·깨진 글/시간
     * 표기 다시 쓰기를 하지 않고, 숨은 칸만 걸러 모델이 쓴 그대로 저장한다. 빈 답 다시 쓰기·연기 아님 끊기는 그대로다(보낸 글이 없다).
     * 이어서 찍은 회차의 첫 답(두 답 중 하나를 고른다)과 소리 없는 영상(근거 검사가 말을 막을 수 있다)은 지금처럼 다 쓴 뒤 보낸다.
     */
    public CoachResult turn(CoachSessionSnapshot session, String actorText, UUID operationId, CoachStream stream) {
        java.util.Objects.requireNonNull(session, "coach session");
        Path local = null;
        DirectVideoModel.Video uploaded = null;
        CoachVideoCache.Key videoKey = null;
        // 대화가 이어지면 올린 영상을 지우지 않고 다음 답에서 다시 쓴다(SOMA-735).
        boolean keepVideo = false;
        boolean videoReused = false;
        Instant started = Instant.now();
        // 단계별 시간(SOMA-780). 느려지면 분류·영상 준비·답 쓰기·줄이기 중 어디서 걸렸는지 로그와 Langfuse 에서 바로 본다.
        long startedNanos = System.nanoTime();
        long classifiedNanos = startedNanos;
        long videoNanos = 0;
        long warmWaitNanos = 0;
        ReplyTrace replyTrace = new ReplyTrace(false);
        // 영상 없이 말로 하는 회차(SOMA-745): 영상을 찾거나 올리지 않고 목적별 코칭을 영상 없는 모드로 탄다.
        PurposeLoop.Purpose selectedPurpose = PurposeLoop.of(session);
        boolean talk = selectedPurpose != null && selectedPurpose.talk();
        // 리딩 녹음으로 시작한 회차(SOMA-791): 영상 대신 리딩 녹음을 이은 소리를 올리고 대본을 함께 보인다.
        boolean listen = selectedPurpose != null && selectedPurpose.listen();
        boolean loop = (practiceLoop || talk || listen) && DirectVideoPracticeLoop.applies(session);
        // 목적별 코칭(SOMA-719): 앱이 목적을 골라 시작한 회차. 지금 흐름의 실험(모델·흐름 A/B, 자문위원 성격)과 섞지 않는다.
        PurposeLoop.Purpose purpose = loop ? selectedPurpose : null;
        String persona = loop && purpose == null ? persona(session, operationId) : "";
        // 맞춤 코칭(SOMA-795)은 자문위원 파일이 없는 배우에게만 붙는다. 글은 대화 상태가 아니라 지금의 기억에서 읽는다.
        String profile = DirectVideoPrompts.ACTOR_PROFILE.equals(persona) ? session.priorForModel().coachingProfile() : null;
        // 맞춤 코칭 설정(SOMA-795): 단계 지시 바꿔 끼우기·쓰지 않을 말 빼기·질문 수 상한. 자문위원 파일이 있는 배우에게는 없다.
        ActorCoaching coaching = profile == null ? null : ActorCoaching.parse(profile);
        String arm = loop && purpose == null ? coachArm(session) : "a";
        String flow = loop && purpose == null ? flow(session, operationId) : CoachFlows.A;
        String alreadyArm = loop && purpose == null ? alreadyArm(session) : ALREADY_OFF;
        String opening = loop && purpose == null ? opening(session, actorText, operationId) : CoachOpenings.A;
        boolean openingB = CoachOpenings.B.equals(opening);
        DirectVideoModel speaker = coachModel(arm);
        var history = new ArrayList<DirectVideoModel.Message>();
        if (loop) {
            history.addAll(DirectVideoPracticeLoop.history(session.turns(), session.coachingState(), actorText));
        } else {
            session.turns().forEach(turn -> history.add(new DirectVideoModel.Message(
                    "ai".equals(turn.role()) ? "model" : "user", turn.text())));
            if (actorText != null) history.add(new DirectVideoModel.Message("user", actorText));
        }
        String input = "";
        String route = "";
        // 기록에 잇는 것은 고른 과제 템플릿뿐이다. 앞에 붙는 배우 프로필·이전 맥락은 요청마다 달라 넣지 않는다.
        LlmPrompt template = null;
        boolean routeFallback = false;
        boolean inspecting = false;
        boolean actorFinished = DialogueProgress.actorFinished(actorText);
        // ConversationService.THREE_LAYERS_REPLY_LIMIT 을 따른다 — 이번 응답이 그 상한을 채우면 강제 종료한다.
        boolean turnBudget = session.turns().stream().filter(t -> "ai".equals(t.role())).count()
                >= ConversationService.THREE_LAYERS_REPLY_LIMIT - 1;
        // 둘째 응답부터: 배우의 말을 따로 분류하고 할 일·횟수·피할 것을 코드가 정한다(PracticeLoopRouter).
        Branch branch = loop && purpose == null && !session.turns().isEmpty() && actorText != null
                ? branch(session, actorText, operationId, flow, coaching, alreadyArm) : null;
        // 목적별 코칭의 둘째 응답부터: 버튼을 눌렀으면 분류 없이, 직접 썼으면 분류해서 코드가 단계를 정한다.
        PurposeLoop.Turn purposeTurn = purpose != null && !session.turns().isEmpty() && actorText != null
                ? purposeTurn(session, purpose, actorText, actorFinished, operationId) : null;
        classifiedNanos = System.nanoTime();
        // 내려놓기 답은 영상 없이 쓴다 — 영상 준비·기다림도 건너뛴다. 영상 파일은 대화가 이어지면 다음 답에서 다시 쓰도록 그대로 둔다.
        // 한 일 묻기(SOMA-855)도 내려놓기처럼 배우 말에 답하는 짧은 질문이라 영상 없이 쓴다.
        final boolean videoOmitted = letGoWithoutVideo && branch != null
                && (PracticeLoopRouter.LET_GO.equals(branch.doing()) || PracticeLoopRouter.ASK_DONE.equals(branch.doing()));
        if (purposeTurn != null && purposeTurn.end()) {
            // 그만: 코치 AI를 부르지 않고 닫는다. 앱은 바로 노트로 넘어간다.
            String closing = fixedClosing(DirectVideoPracticeLoop.replyLanguage(session, actorText), talk, listen);
            videoCache.forget(session.practiceSessionId());
            ObjectNode state = nextState(session);
            DirectVideoPracticeLoop.remember(state, new DirectVideoPracticeLoop.Parsed("", PurposeLoop.status(purposeTurn, ""), closing));
            PurposeLoop.remember(state, purposeTurn, PurposeLoop.extract(""));
            return StructuredCoachEngine.result(session, actorText, closing, state, "actor_finished");
        }
        if (branch != null && PracticeLoopRouter.END.equals(branch.doing())) {
            // 그만·자기 한 줄·응답 상한: 코치 AI를 부르지 않고 닫는다. 앱은 바로 노트로 넘어간다.
            String closing = fixedClosing(DirectVideoPracticeLoop.replyLanguage(session, actorText), talk, listen);
            videoCache.forget(session.practiceSessionId());
            ObjectNode state = nextState(session);
            DirectVideoPracticeLoop.remember(state, new DirectVideoPracticeLoop.Parsed("", branch.status(), closing));
            // 닫힌 사유: 배우가 그만 → user_ended, 응답 상한 → limit, 그 밖(물을 것을 다 물음) → exhausted.
            boolean stopped = actorFinished || branch.classified().kind() == PracticeLoopRouter.Kind.STOP;
            boolean ceiling = turnBudget || branch.before().reply() >= PracticeLoopRouter.LAST_REPLY - 1;
            return StructuredCoachEngine.result(session, actorText, closing, state,
                    stopped ? "actor_finished" : ceiling ? "turn_budget" : "interrupted");
        }
        if (loop && !talk && !listen && DirectVideoPracticeLoop.tooShort(session)) {
            // 연기가 담길 수 없는 길이 — 영상을 올리거나 모델을 부르지 않고 끊는다. 노트도 만들지 않는다.
            ObjectNode cutState = nextState(session);
            DirectVideoPracticeLoop.markNotActing(cutState, "too_short");
            return StructuredCoachEngine.result(session, actorText,
                    DirectVideoPracticeLoop.notActingMessage(DirectVideoPracticeLoop.replyLanguage(session, actorText)),
                    cutState, "interrupted");
        }
        try {
            var source = talk || listen ? null : videos.find(session.userId(), session.practiceSessionId());
            if (!talk && !listen && source == null) throw new IllegalStateException("owned video is unavailable");
            // 리딩 녹음 회차: 대본과 줄별 시간은 매 답마다 읽고, 소리 파일은 올려 둔 것이 없을 때만 잇는다(아래).
            CoachReadingAudio.Prepared reading = null;
            if (listen) {
                reading = readingAudio.prepare(session.userId(), session.practiceSessionId(), false);
                if (reading == null) throw new IllegalStateException("reading audio is unavailable");
                videoKey = new CoachVideoCache.Key(session.practiceSessionId(), "reading-voice:" + reading.sourceKey(), null);
            }
            // 얼굴 가리기 회차는 원본이 아니라 가린 사본을 올린다 — 원본 준비·이름표와 섞이지 않게 키를 따로 쓴다.
            if (!talk && !listen) videoKey = new CoachVideoCache.Key(session.practiceSessionId(),
                    source.faceMosaic() ? CoachVideoCache.faceMosaicSource(source.objectKey()) : source.objectKey(),
                    source.etag());
            String mimeType = talk ? null : listen ? reading.mimeType()
                    : source.faceMosaic() ? "video/mp4" : source.mimeType();
            DirectVideoModel.InputInspection inspection = null;
            boolean firstLoop = loop && session.turns().isEmpty();
            // 둘째 답부터는 이 대화에서 올려 둔 영상을 다시 쓴다. 배포로 서버가 바뀌었으면 이름표로 찾는다(SOMA-780).
            // 소리·빈 영상 검사는 첫 답에서만 돈다.
            if (videoOmitted || talk) {
                // 영상을 붙이지 않는다. 올려 둔 영상은 건드리지 않는다. 말로 하는 회차는 영상이 없다.
            } else if (!session.turns().isEmpty()) {
                DirectVideoModel.Video remembered = videoCache.take(videoKey);
                if (remembered != null) {
                    try {
                        if (model.ready(remembered)) uploaded = remembered;
                    } catch (RuntimeException gone) {
                        // 지워졌거나 만료됐다 — 아래에서 다시 올린다.
                    }
                    if (uploaded == null) videoCache.forget(session.practiceSessionId());
                }
            } else if (firstLoop && !listen) {
                // 첫 답: 분석 작업이 미리 검사·올려 둔 영상이 있으면 기다려 쓴다(SOMA-780). 없거나 실패했으면 아래에서 직접 한다.
                long warmStarted = System.nanoTime();
                // 미리 준비가 10초 넘게 걸리면 같은 원본을 새로 올리는 일을 함께 시작해 먼저 끝난 쪽을 쓴다(10/27).
                // 얼굴 가리기 사본은 만드는 데 오래 걸려 겹쳐 하지 않는다.
                var original = source;
                String hedgeMime = mimeType;
                String hedgeLabel = videoCache.label(videoKey);
                CoachVideoCache.Prepared warmed = videoCache.claimWarm(videoKey, CoachVideoCache.WARM_WAIT,
                        CoachVideoCache.HEDGE_AFTER,
                        source.faceMosaic() ? null : () -> prepareDirect(original, hedgeMime, hedgeLabel));
                warmWaitNanos = System.nanoTime() - warmStarted;
                if (warmed != null) {
                    inspection = warmed.inspection();
                    uploaded = warmed.video();
                }
            }
            videoReused = uploaded != null;
            // 미리 준비의 소리 검사에서 막혔으면 내려받지 않고 아래에서 바로 안내한다.
            boolean blocked = inspection != null && (inspection.unusableAudio() || inspection.emptyInput());
            if (!videoReused && !blocked && !videoOmitted && !talk && !listen) {
                local = Files.createTempFile("coach-original-", ".video");
                var metadata = storage.downloadToPath(source.objectKey(), local);
                if (source.etag() != null && !source.etag().isBlank()
                        && !source.etag().replace("\"", "").equals(metadata.etag().replace("\"", ""))) {
                    throw new IllegalStateException("original video changed after upload");
                }
                // 얼굴 가리기: 원본 대신 얼굴을 가린 사본을 검사·올린다. 만들 수 없으면 원본을 올리지 않고 이 답을 실패로 닫는다.
                // 얼굴이 아예 없으면 원본을 그대로 받으므로 원본 형식으로 올린다.
                if (source.faceMosaic()) {
                    Path original = local;
                    local = masked(local);
                    if (local.equals(original)) mimeType = source.mimeType();
                }
            }
            if (listen && !videoReused && !videoOmitted) {
                CoachReadingAudio.Prepared withAudio = readingAudio.prepare(session.userId(), session.practiceSessionId(), true);
                if (withAudio == null || withAudio.audio() == null) throw new IllegalStateException("reading audio is unavailable");
                reading = withAudio;
                local = withAudio.audio();
            }
            if (!videoReused && !videoOmitted && !talk) {
                // 리딩 녹음은 서버가 소리 든 줄만 골라 잇는다 — 영상의 소리·빈 화면 검사는 하지 않는다.
                if (firstLoop && !listen) {
                    if (inspection == null) {
                        inspecting = true;
                        inspection = model.inspect(local);
                        inspecting = false;
                    }
                    if (inspection != null && inspection.unusableAudio()) {
                        ObjectNode cutState = nextState(session);
                        DirectVideoPracticeLoop.markInputIssue(cutState, "silent_audio");
                        return StructuredCoachEngine.result(session, actorText,
                                DirectVideoPracticeLoop.audioUnavailableMessage(
                                        DirectVideoPracticeLoop.replyLanguage(session, actorText)),
                                cutState, "interrupted");
                    }
                    if (inspection != null && inspection.emptyInput()) {
                        ObjectNode cutState = nextState(session);
                        DirectVideoPracticeLoop.markNotActing(cutState, "empty_input");
                        return StructuredCoachEngine.result(session, actorText,
                                DirectVideoPracticeLoop.notActingMessage(
                                        DirectVideoPracticeLoop.replyLanguage(session, actorText)),
                                cutState, "interrupted");
                    }
                }
                ExternalOperationExecution.externalCall("video_upload");
                String label = videoCache.label(videoKey);
                uploaded = label != null ? model.upload(local, mimeType, inspection, label)
                        : inspection == null || inspection.hasAudioTrack() == null
                        ? model.upload(local, mimeType) : model.upload(local, mimeType, inspection);
                long deadline = System.nanoTime() + Duration.ofSeconds(180).toNanos();
                while (!model.ready(uploaded)) {
                    if (System.nanoTime() >= deadline) throw new IllegalStateException("video processing timed out");
                    Thread.sleep(500);
                }
            }
            videoNanos = System.nanoTime();
            String written = DirectVideoPracticeLoop.actorMaterial(session) + "\n"
                    + session.turns().stream().filter(turn -> !"ai".equals(turn.role()))
                            .map(turn -> turn.text()).collect(java.util.stream.Collectors.joining("\n"))
                    + "\n" + (actorText == null ? "" : actorText);
            ObjectNode state = nextState(session);
            // 1층 관찰(SOMA-815): 배정된 연습이고 끝났으면 칸을 붙이고 상태에 남긴다. 안 끝났으면 기다리지 않는다.
            String layerArm = layerOneArm(session);
            String layerBlock = loop ? layerOneBlock(session, state, layerArm) : "";
            if (!persona.isEmpty()) DirectVideoPracticeLoop.rememberPersona(state, persona);
            if (loop && purpose == null) DirectVideoPracticeLoop.rememberCoachModel(state, arm);
            if (loop && purpose == null) DirectVideoPracticeLoop.rememberFlow(state, flow);
            if (loop && purpose == null) DirectVideoPracticeLoop.rememberAlready(state, alreadyArm);
            if (loop && purpose == null) DirectVideoPracticeLoop.rememberOpening(state, opening);
            if (loop) {
                DirectVideoDialogueEvidence.discardUngroundedDesign(uploaded, state, written);
                history.clear();
                history.addAll(DirectVideoPracticeLoop.history(session.turns(), state, actorText));
            }
            String task;
            // 이어서 찍은 회차의 같은 장면 판단(받아 적기)과 지난 시도 첫 답을 기본 첫 답과 함께 돌린다(아래).
            String continuationBlock = null;
            PriorContext continuationPrior = null;
            java.util.concurrent.CompletableFuture<String> heardFuture = null;
            if (purposeTurn != null) {
                route = "purpose:" + (purpose.talk() ? "talk:" : "") + purpose.id + ":" + purposeTurn.doing();
                PurposeLoop.rememberAnswer(state, purposeTurn.answeredStep(), actorText);
                history.clear();
                history.addAll(DirectVideoPracticeLoop.history(session.turns(), state, actorText, false));
                task = PurposeLoop.turnPrompt(purpose) + "\n\n" + PurposeLoop.instruction(purposeTurn, state, actorText);
                template = new LlmPrompt(purpose.talk() ? "coach.purpose.talk.turn" : purpose.listen() ? "coach.purpose.reading.turn"
                        : "coach.purpose.turn", PurposeLoop.turnPrompt(purpose));
            } else if (branch != null) {
                route = "practice_loop:" + branch.doing();
                java.util.Locale language = DirectVideoPracticeLoop.replyLanguage(session, actorText);
                history.clear();
                history.addAll(DirectVideoPracticeLoop.history(session.turns(), state, actorText, false));
                String design = state.path(DirectVideoPracticeLoop.STATE_KEY).path("design").asText("");
                boolean koreanTurn = language == null || "ko".equals(language.getLanguage());
                String stepTask = DirectVideoPrompts.practiceLoopTask(branch.doing(), language, flow);
                // 맞춤 코칭은 단계 지시 자체를 바꿔 끼운다 — 끝에 붙인 메모로는 "둘 중 고르는 질문" 같은 단계 지시가 이겼다(SOMA-795).
                if (coaching != null && koreanTurn) stepTask = coaching.stepTask(branch.doing(), stepTask);
                String common = DirectVideoPrompts.practiceLoopTurn(language) + "\n\n" + branch.instruction(language, stepTask)
                        + DirectVideoPrompts.flowBlock(flow, language);
                if (coaching != null && koreanTurn) common = coaching.turnTask(coaching.withoutNeverSay(common));
                // 질문 아래 예시 답 1~2개(숨은 <보기>). 성격 글은 늘 맨 끝에 둔다.
                task = common + AnswerExamples.INSTRUCTION + personaBlock(persona, profile, language);
                // 자문위원과 맞춤 코칭 배우 모두 "어때요?" 예문을 뺀다(SOMA-795 재생 v2: 맞춤 코칭 배우에게 "~해 보는 건 어때요?"가 남았다).
                // 성격이 없는 배우(맞춤 코칭 없음)의 할 일 파일은 그대로다.
                if (!persona.isEmpty()) task = DirectVideoPrompts.withoutHowAbout(task);
                task = task + DirectVideoPrompts.openingTurnBlock(opening, language);
                boolean korean = language == null || "ko".equals(language.getLanguage());
                template = korean ? new LlmPrompt("coach.practice-loop.turn", DirectVideoPrompts.practiceLoopTurn())
                        : new LlmPrompt("coach.practice-loop.turn.en", DirectVideoPrompts.practiceLoopTurnEnglish());
            } else if (loop && purpose != null) {
                // 목적별 첫 답. 이어서 찍은 회차의 "지난 시도부터 묻기"는 지금 흐름의 것이라 붙이지 않는다(지난 맥락 칸은 그대로 받는다).
                route = "purpose:" + (purpose.talk() ? "talk:" : "") + purpose.id;
                task = PurposeLoop.firstPrompt(purpose);
                template = new LlmPrompt("coach.purpose." + (purpose.talk() ? "talk." : "") + purpose.id, task);
            } else if (loop) {
                // 종료("그만")도 연습 루프가 해 본 횟수로 닫는다. 서버는 아래에서 세션만 닫는다.
                route = "practice_loop";
                java.util.Locale language = DirectVideoPracticeLoop.replyLanguage(session, actorText);
                // 이어서 찍은 회차면 이번 영상 대사를 지난 정보 없이 따로 받아 적고, 지난 회차 대사가 다시 들렸을 때만
                // (같은 장면) 첫 질문 대신 지난 시도부터 묻는다. 받아 적기가 실패하거나 겹치지 않으면 지금 그대로다.
                // 개인 프롬프트의 첫 질문 모양보다 먼저라 그 뒤에 붙인다.
                PriorContext prior = session.priorForModel();
                if (prior.earlierConversation() != null && !prior.previousLines().isEmpty()
                        && !Boolean.FALSE.equals(uploaded.hasAudioTrack())) {
                    continuationPrior = prior;
                    continuationBlock = DirectVideoPrompts.continuation(prior, language);
                    final DirectVideoModel.Video heardVideo = uploaded;
                    Runnable heardCall = ExternalOperationExecution.observeCall("model");
                    heardFuture = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
                        heardCall.run();
                        try {
                            return model.reply(heardVideo, java.util.List.of(), ContinuedTake.heardLinesPrompt());
                        } catch (RuntimeException transcriptionFailed) {
                            return null;
                        }
                    }, SIDE_CALLS);
                }
                String first = DirectVideoPrompts.practiceLoop(session.practiceSessionId(), language);
                if (coaching != null && (language == null || "ko".equals(language.getLanguage()))) {
                    first = coaching.withoutNeverSay(coaching.firstTask(first));
                }
                task = first + AnswerExamples.INSTRUCTION + personaBlock(persona, profile, language)
                        + DirectVideoPrompts.openingBlock(opening, language);
                // 기록에는 칸 순서를 섞기 전 템플릿을 잇는다. 섞인 본문마다 Langfuse 버전이 새로 생기지 않게 한다.
                boolean korean = language == null || "ko".equals(language.getLanguage());
                template = korean ? new LlmPrompt("coach.practice-loop", DirectVideoPrompts.practiceLoop())
                        : new LlmPrompt("coach.practice-loop.en", DirectVideoPrompts.practiceLoopEnglish());
            } else {
                var selection = routing.select(history, actorText, actorFinished || turnBudget,
                        session.practiceSessionId(), session.userId(), operationId);
                route = selection.label();
                routeFallback = selection.fallback();
                task = selection.prompt();
                template = new LlmPrompt("coach.direct." + route, task);
            }
            // 연습 루프는 배우가 이번 연습에 적은 것(상황·인물·목표·막힘)도 받는다. 없으면 칸이 없다.
            String prompt = DirectVideoPrompts.withAudioFacts(DirectVideoPrompts.withFaceMosaicFact(
                    CoachPrompt.actorProfileBlock(session.actorProfile())
                    + CoachPrompt.priorContextBlock(session.priorForModel().withoutCoachGuesses(), true, false)
                    + (loop && !talk ? proMemoryBlock(session, state) : "")
                    + (loop ? DirectVideoPracticeLoop.actorMaterial(session) + layerBlock : "")
                    + (listen ? reading.material() + "\n\n" : "") + task,
                    !talk && !listen && source.faceMosaic()), uploaded);
            // 말로 하는 회차는 영상이 없어 첫 응답의 대화 기록이 비고, 모델은 빈 대화를 받지 않는다. 시작을 알리는 배우 쪽 한 줄을
            // 대화 맨 앞에 둔다(저장하지 않는 모델 입력이다). 둘째 응답부터도 같은 줄이 맨 앞에 있어 대화가 배우 말로 시작한다.
            if (talk) history.addFirst(new DirectVideoModel.Message("user", PurposeLoop.talkOpening(purpose)));
            input = CoachPrompt.withoutActorName(prompt, session.actorProfile()) + "\n" + history;
            // 이어서 찍은 회차: 받아 적기와 "지난 시도부터 묻는 첫 답"을 기본 첫 답과 동시에 돌린다. 받아 적기로 같은 장면이
            // 확인될 때만 그 답을 쓴다. 차례로 돌리면 첫 답이 15초쯤 늦어져서(2026-10-15 로컬 재생) 기다리는 시간을 늘리지 않는다.
            String continuedPrompt = continuationBlock == null ? null : prompt + continuationBlock;
            java.util.concurrent.CompletableFuture<String> continuedFuture = null;
            if (continuedPrompt != null) {
                final DirectVideoModel speakerFinal = speaker;
                final DirectVideoModel.Video continuedVideo = uploaded;
                final java.util.List<DirectVideoModel.Message> continuedHistory = java.util.List.copyOf(history);
                final boolean loopFinal = loop;
                Runnable continuedCall = ExternalOperationExecution.observeCall("model");
                continuedFuture = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
                    continuedCall.run();
                    try {
                        return replyOrNull(speakerFinal, continuedVideo, continuedHistory, continuedPrompt, loopFinal, new ReplyTrace(false));
                    } catch (RuntimeException continuedFailed) {
                        return null;
                    }
                }, SIDE_CALLS);
            }
            // 스트리밍: 연습 루프의 보통 턴만. 이어서 찍은 첫 답(고르기)·소리 없는 영상(근거 검사)은 다 쓴 뒤 한 번에 보낸다.
            final boolean streaming = stream != null && loop && continuedPrompt == null
                    && (uploaded == null || !Boolean.FALSE.equals(uploaded.hasAudioTrack()));
            java.util.Locale replyLanguage = DirectVideoPracticeLoop.replyLanguage(session, actorText);
            final VisibleCoachText visible = streaming ? new VisibleCoachText(session.turns().isEmpty(), replyLanguage, stream::delta) : null;
            // 답장(첫 질문이 아닌 턴)은 생각을 최소로 쓴다(SOMA-780). 첫 질문·분류·정리 노트는 그대로 LOW 다.
            final ReplyTrace trace = new ReplyTrace(followUpMinimalThinking && !session.turns().isEmpty());
            replyTrace = trace;
            ExternalOperationExecution.externalCall("model");
            String message = streaming ? streamOrNull(speaker, uploaded, history, prompt, visible, trace)
                    : replyOrNull(speaker, uploaded, history, prompt, loop, trace);
            // 연습 루프에서 배우에게 보일 말이 비었으면(빈 응답, 숨은 메모만 쓴 응답) 한 번 다시 쓰게 한다.
            boolean emptyRetry = false;
            boolean lightRetry = false;
            if (loop && (message == null || DirectVideoPracticeLoop.parse(message).message().isBlank())) {
                emptyRetry = true;
                ExternalOperationExecution.externalCall("model");
                String retryPrompt = prompt + "\n\n"
                        + DirectVideoPracticeLoop.emptyRetryNote(DirectVideoPracticeLoop.replyLanguage(session, actorText));
                message = streaming ? streamOrNull(speaker, uploaded, history, retryPrompt, visible, trace)
                        : replyOrNull(speaker, uploaded, history, retryPrompt, loop, trace);
                // 다시 써도 비었으면 생각을 거의 하지 않게 한 번 더 쓴다(스트리밍이어도 다 쓴 뒤 한 번에 보낸다).
                // 2026-10-21 재생: 빈 답 두 번 중 하나는 영어 생각 메모만 쓰다 한도에 닿았고, 하나는 빈 글만 냈다. 같은 지시를 일반 호출로 보내면 답이 나왔다.
                // 앱은 한 요청을 60초까지 기다린다. 이미 40초를 넘겼으면 더 쓰지 않고 실패로 돌린다(배우가 다시 보내면 된다).
                boolean timeLeft = Duration.between(started, Instant.now()).compareTo(LIGHT_RETRY_BUDGET) < 0;
                if (timeLeft && (message == null || DirectVideoPracticeLoop.parse(message).message().isBlank())) {
                    lightRetry = true;
                    ExternalOperationExecution.externalCall("model");
                    message = lightOrNull(speaker, uploaded, history, retryPrompt, trace);
                }
            }
            // 대화와 상관없는 글(웹페이지·코드·자모)이 나오면 배우에게 보내지 않고 한 번 다시 쓰게 한다.
            // 다시 써도 깨졌으면 빈 답과 같이 실패로 돌린다 — 엉뚱한 말을 보내느니 다시 보내게 하는 편이 낫다.
            // 스트리밍도 같다: 보일 글이 깨지면 VisibleCoachText 가 그 자리에서 끊고(streamOrNull 이 깨진 글을 돌려준다) 여기서 다시 쓴다.
            boolean brokenRetry = false;
            if (loop && message != null && DirectVideoPracticeLoop.looksBroken(DirectVideoPracticeLoop.parse(message).message(), replyLanguage)) {
                brokenRetry = true;
                ExternalOperationExecution.externalCall("model");
                String brokenPrompt = prompt + "\n\n" + DirectVideoPracticeLoop.brokenRetryNote(replyLanguage);
                message = streaming ? streamOrNull(speaker, uploaded, history, brokenPrompt, visible, trace)
                        : replyOrNull(speaker, uploaded, history, brokenPrompt, loop, trace);
                if (message != null && DirectVideoPracticeLoop.looksBroken(DirectVideoPracticeLoop.parse(message).message(), replyLanguage)) {
                    message = null;
                }
            }
            // 비교 모델이 다시 써도 비거나 깨졌으면 기본 모델로 한 번 더 쓴다(SOMA-657). 3.8은 같은 입력에서 빈 답이 몰려 나왔다.
            // 배우에게 오류 화면을 보이느니 몇 초 더 기다리게 하는 편이 낫다.
            boolean modelFallback = false;
            if (loop && speaker != model && (message == null || DirectVideoPracticeLoop.parse(message).message().isBlank())) {
                modelFallback = true;
                ExternalOperationExecution.externalCall("model");
                message = streaming ? streamOrNull(model, uploaded, history, prompt, visible, trace)
                        : replyOrNull(model, uploaded, history, prompt, loop, trace);
                if (message != null && DirectVideoPracticeLoop.looksBroken(DirectVideoPracticeLoop.parse(message).message(), replyLanguage)) {
                    message = null;
                }
            }
            if (heardFuture != null) {
                java.util.List<String> heard = ContinuedTake.parseHeardLines(awaitSide(heardFuture, SIDE_WAIT_SECONDS));
                ContinuedTake.remember(state, heard);
                String continued = ContinuedTake.sameScene(continuationPrior.previousLines(), heard)
                        ? awaitSide(continuedFuture, SIDE_WAIT_SECONDS) : null;
                if (continuedFuture != null && continued == null) continuedFuture.cancel(true);
                if (continued != null && !DirectVideoPracticeLoop.parse(continued).message().isBlank()
                        && !DirectVideoPracticeLoop.looksBroken(DirectVideoPracticeLoop.parse(continued).message(), replyLanguage)) {
                    message = continued;
                    prompt = continuedPrompt;
                    input = CoachPrompt.withoutActorName(prompt, session.actorProfile()) + "\n" + history;
                }
            }
            if (message == null || message.isBlank()) throw new IllegalStateException("empty video coaching reply");
            DirectVideoDialogueEvidence.requireGrounded(uploaded, message, written);
            // 영상 시간("0:23", "0:03부터 0:46까지")으로 구간을 가리키면 한 번 다시 쓰게 한다. 배우는 시간으로 장면을 떠올리지 못한다.
            boolean timeRetry = false;
            if (loop && !streaming && DirectVideoPracticeLoop.hasTimestamp(DirectVideoPracticeLoop.parse(message).message())) {
                timeRetry = true;
                ExternalOperationExecution.externalCall("model");
                // 다시 쓴 답이 비거나 한도에 걸려 끊기면 처음 답을 쓰고 시간만 걷어낸다.
                String again = replyOrNull(speaker, uploaded, history, prompt + "\n\n"
                        + DirectVideoPracticeLoop.timestampRetryNote(DirectVideoPracticeLoop.replyLanguage(session, actorText)), loop, trace);
                if (again != null && !again.isBlank() && !DirectVideoPracticeLoop.parse(again).message().isBlank()) {
                    try {
                        DirectVideoDialogueEvidence.requireGrounded(uploaded, again, written);
                        message = again;
                    } catch (IllegalStateException ungrounded) {
                        // 다시 쓴 답이 근거 검사를 못 넘으면 처음 답을 쓰고 시간만 걷어낸다.
                    }
                }
            }
            var parsed = loop ? DirectVideoPracticeLoop.parse(message) : null;
            PurposeLoop.Output purposeOut = purpose != null ? PurposeLoop.extract(message) : null;
            String purposeTake = "";
            if (purposeTurn != null) {
                // 상태 칸은 서버가 쓴다. 정리의 행동 한 줄은 노트의 다음 촬영이 된다(숨은 줄을 빠뜨렸으면 정리 말의 행동 문장).
                String take = purposeTurn.wrap() ? DirectVideoPracticeLoop.nextTake(message) : "";
                if (purposeTurn.wrap() && take.isBlank()) take = DirectVideoPracticeLoop.actionLine(parsed.message());
                if (listen && purposeTurn.wrap()) take = PurposeLoop.readingTake(take, reading.material());
                purposeTake = take;
                String status = PurposeLoop.status(purposeTurn, take);
                DirectVideoDialogueEvidence.requireGrounded(uploaded, "<상태>\n" + status + "\n</상태>", written);
                parsed = new DirectVideoPracticeLoop.Parsed("", status, parsed.message());
            }
            if (branch != null) {
                // 숨은 칸은 모델이 아니라 서버가 쓴다. 모델이 따라 쓴 태그는 parse 가 이미 걷어냈다.
                // 정리의 행동, 또는 정리 뒤 배우 해석을 받아 준 답의 행동을 노트의 다음 촬영으로 남긴다(뒤의 것이 앞의 것을 덮고, 숨은 줄이 없으면 앞의 것이 남는다).
                // 숨은 다음 테이크 줄을 빠뜨렸으면 배우에게 한 정리 말의 행동 문장을 쓴다(SOMA-657). 노트가 코치 말과 어긋나지 않게 한다.
                String take = DirectVideoPracticeLoop.nextTake(message);
                if (take.isBlank()) take = DirectVideoPracticeLoop.actionLine(parsed.message());
                String status = branch.status(PracticeLoopRouter.WRAP_UP.equals(branch.doing()) ? take
                        : branch.acceptsReading() ? READING_LEAD.matcher(take).replaceFirst("") : "");
                DirectVideoDialogueEvidence.requireGrounded(uploaded, "<상태>\n" + status + "\n</상태>", written);
                parsed = new DirectVideoPracticeLoop.Parsed("", status, parsed.message());
            }
            // 배우에게는 코치 본문만 저장한다. 숨은 칸(<설계>·<상태>)은 아래에서 상태에 둔다.
            String shown = loop ? parsed.message() : message.strip();
            // 첫 응답에서 모델이 연기 영상이 아니라고 분류했으면 그 코치 문장은 버리고 끊는다.
            boolean cut = loop && !talk && !listen && session.turns().isEmpty() && DirectVideoPracticeLoop.notActing(parsed);
            if (cut) shown = DirectVideoPracticeLoop.notActingMessage(DirectVideoPracticeLoop.replyLanguage(session, actorText));
            // 첫 응답은 질문 한 문장이다. 앞에 붙인 인사·작품 설명 같은 군말은 걷어낸다.
            // 첫 코칭 첫 말 B는 본 것·다음 테이크·질문까지 여러 줄이 한 덩어리라 질문 줄만 남기지 않는다.
            if (loop && !cut && !streaming && session.turns().isEmpty() && !(openingB && purpose == null)
                    && (purpose == null || !PurposeLoop.keepsWholeOpening(purpose))) {
                shown = DirectVideoPracticeLoop.onlyFirstQuestion(shown);
            }
            if (branch != null && !streaming) {
                boolean last = branch.doing().startsWith(PracticeLoopRouter.WRAP_UP) || branch.closeNext();
                // 정리와 정리 뒤 답은 질문하지 않는다. 질문 문장은 떼고, 다 떼면 원래 말을 둔다.
                // 그 밖의 말은 질문이 둘 이상이면 첫 질문까지만 남긴다.
                shown = last ? DirectVideoPracticeLoop.withoutQuestions(shown) : DirectVideoPracticeLoop.firstQuestionOnly(shown);
                // 배우가 방금 한 말을 첫 문장에서 그대로 되풀이하면 뗀다.
                shown = DirectVideoPracticeLoop.withoutEcho(shown, actorText);
            }
            if (purposeTurn != null && !streaming) {
                shown = purposeTurn.wrap() || PurposeLoop.asksNothing(purpose) ? DirectVideoPracticeLoop.withoutQuestions(shown)
                        : DirectVideoPracticeLoop.firstQuestionOnly(shown);
                shown = DirectVideoPracticeLoop.withoutEcho(shown, actorText);
            }
            // 배우가 대안을 말하지 않았는데 정리를 "맞아요, 그거예요"로 시작하면 그 인정 말을 뗀다.
            if (branch != null && !streaming && PracticeLoopRouter.WRAP_UP.equals(branch.doing()) && !branch.actorFoundAlternative()) {
                shown = DirectVideoPracticeLoop.withoutAgreement(shown);
            }
            // 배우가 반박·정정·질문·요청을 했는데 "맞아요"로 시작하면 엉뚱한 동의가 된다. 그 말을 뗀다.
            // 2026-10-20 21:34 운영: "저게 답변이야?"에 "맞아요. ~ 또렷하게 꽂혀요."로 답했다.
            if (branch != null && !streaming && !agreeable(branch.classified().kind())) {
                shown = DirectVideoPracticeLoop.withoutAgreement(shown);
            }
            boolean timeStripped = false;
            if (loop && !streaming && DirectVideoPracticeLoop.hasTimestamp(shown)) {
                shown = DirectVideoPracticeLoop.stripTimestamps(shown);
                timeStripped = true;
            }
            if (shown.isBlank()) throw new IllegalStateException("empty video coaching reply");
            // 비유가 섞였거나 바로 앞에서 한 질문을 다시 하면, 그 부분만 고치는 가벼운 호출(영상 없음)로 한 번 다듬는다.
            // 스트리밍도 같다 — 다 쓴 뒤 저장한 말이 한 번 더 나가 화면을 덮는다. 고치지 못하면 반복 질문만 뗀다.
            // 2026-10-21 재생: "~하려던 건 뭐였어요?"를 두 번 연달아 물었고, "튕겨 나갈 거예요"·"무게감" 같은 비유가 나왔다.
            // 말로 하는 회차(SOMA-745)는 배우가 적지 않은 대사를 따온 문장을 뗀다. 영상도 대본도 없으니 그 따옴표는 지어낸 것이다.
            if (listen) {
                // 리딩 녹음: 따옴표 안 대사는 대본이나 배우가 적은 말에 있어야 한다. 결과 장담 문장도 뗀다(reading/mode 규칙).
                shown = PurposeLoop.withoutUngroundedQuotes(shown, reading.material() + "\n" + session.turns().stream()
                        .filter(t -> !"ai".equals(t.role())).map(t -> t.text()).collect(java.util.stream.Collectors.joining("\n"))
                        + "\n" + (actorText == null ? "" : actorText));
                shown = PurposeLoop.withoutPromises(shown);
                if (purposeTurn != null && purposeTurn.wrap()) shown = PurposeLoop.withoutPlainTail(shown);
            }
            if (talk) {
                shown = PurposeLoop.withoutUngroundedQuotes(shown, session.turns().stream().filter(t -> !"ai".equals(t.role()))
                        .map(t -> t.text()).collect(java.util.stream.Collectors.joining("\n")) + "\n" + (actorText == null ? "" : actorText));
                // 결과를 장담하는 문장도 뗀다(talk/mode 규칙). 스트리밍도 다 쓴 뒤 저장한 말이 화면을 덮는다.
                shown = PurposeLoop.withoutPromises(shown);
                // 정리 뒤 답은 묻지 않는다 — 지시에도 모델이 "~골라 볼까요?"를 붙였다(10/27 폰 재생). 물음 문장을 뗀다(남는 게 없으면 그대로).
                if (PurposeLoop.answersAfterWrap(purposeTurn)) shown = DirectVideoPracticeLoop.withoutQuestions(shown);
            }
            int polished = 0;
            if (loop && !cut) {
                String actorWords = session.turns().stream().filter(t -> !"ai".equals(t.role())).map(t -> t.text())
                        .collect(java.util.stream.Collectors.joining("\n")) + "\n" + (actorText == null ? "" : actorText);
                java.util.List<String> earlier = session.turns().stream().filter(t -> "ai".equals(t.role())).map(t -> t.text()).toList();
                java.util.List<String> figures = DirectVideoPracticeLoop.metaphors(shown, actorWords);
                String repeated = DirectVideoPracticeLoop.repeatedQuestion(shown, earlier);
                java.util.List<String> said = DirectVideoPracticeLoop.repeatedLines(shown, earlier);
                if (!figures.isEmpty() || !repeated.isEmpty() || !said.isEmpty()) {
                    String better = polish(shown, figures, repeated, said, earlier, actorWords, replyLanguage, uploaded, written, operationId);
                    polished = 1;
                    if (better != null) {
                        // 다듬기가 질문을 하나 더 붙이기도 한다(재생). 정리와 정리 뒤 답은 질문 없이, 그 밖은 첫 질문까지만 남긴다.
                        boolean closing = branch != null && (PracticeLoopRouter.WRAP_UP.equals(branch.doing()) || branch.closeNext())
                                && !PracticeLoopRouter.LET_GO.equals(branch.doing());
                        shown = closing ? DirectVideoPracticeLoop.withoutQuestions(better) : DirectVideoPracticeLoop.firstQuestionOnly(better);
                    }
                    else if (!repeated.isEmpty() && !DirectVideoPracticeLoop.repeatedQuestion(shown, earlier).isEmpty()) {
                        shown = DirectVideoPracticeLoop.withoutQuestions(shown);
                    }
                }
            }
            // 앱이 코치 말을 아주 큰 글씨로 보여서 50자 안쪽이 목표다. 상한(공용 60자)을 넘으면 자르지 않고 줄이기만 하는 호출로 두 번까지 줄인다.
            // 자문위원 프롬프트는 사람마다 길이 상한을 따로 둔다(SOMA-622). 없으면 공용 상한 60자다.
            int replyLimit = loop ? DirectVideoPrompts.personaReplyLimit(persona, DirectVideoPracticeLoop.replyLanguage(session, actorText), profile)
                    : DirectVideoPracticeLoop.LONG_REPLY;
            int shortened = 0;
            long repliedNanos = System.nanoTime();
            // 배우가 설명·피드백을 달라고 한 답은 길게 둔다(줄이면 다시 한 구절 + 질문이 되어 물음에 답하지 못한다).
            // 자문위원 프롬프트의 사람별 상한(SOMA-622)과 함께 쓸 때는 둘 중 큰 쪽을 쓴다.
            int limit = branch != null && branch.explains() ? Math.max(DirectVideoPracticeLoop.EXPLAIN_REPLY, replyLimit) : replyLimit;
            if (purpose != null && PurposeLoop.explains(purpose, purposeTurn)) limit = Math.max(limit, DirectVideoPracticeLoop.EXPLAIN_REPLY);
            // B 흐름에서 코치가 본 것을 말하는 응답은 이유 한 문장까지 세 문장이다. 줄이면 이유가 빠져 다시 떠보는 질문이 된다.
            if (branch != null && CoachFlows.B.equals(flow) && PracticeLoopRouter.GAP.equals(branch.doing())) limit = Math.max(limit, TELL_REPLY);
            // 다르게 정리(SOMA-855)는 배우가 한 것 인정 + 덜 들린 대사 + 새 행동까지 말한다.
            if (branch != null && PracticeLoopRouter.WRAP_DONE.equals(branch.doing())) limit = Math.max(limit, TELL_REPLY);
            // 첫 코칭 첫 말 B의 첫 응답은 200자 안쪽 여러 줄이 목표다. 줄이기는 40~60자 질문 한 줄로 만들어 버리므로 건너뛴다.
            if (openingB && session.turns().isEmpty()) limit = Integer.MAX_VALUE;
            while (loop && !cut && !streaming && shortened < 2 && DirectVideoPracticeLoop.displayLength(shown) > limit) {
                String shorter = shorten(shown, DirectVideoPracticeLoop.replyLanguage(session, actorText), persona, profile, uploaded, written, operationId);
                shortened++;
                if (shorter == null) break;
                shown = shorter;
            }
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(),
                    speaker.model(), input, message, LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    null, LlmCall.metadata("transport", "gemini_direct_video", "route", route,
                            "route_fallback", Boolean.toString(branch != null ? "fallback".equals(branch.classified().by()) : routeFallback),
                            "timestamp_retry", Boolean.toString(timeRetry), "timestamp_stripped", Boolean.toString(timeStripped),
                            "shorten_calls", Integer.toString(shortened), "polish_calls", Integer.toString(polished), "empty_retry", Boolean.toString(emptyRetry), "light_retry", Boolean.toString(lightRetry), "broken_retry", Boolean.toString(brokenRetry),
                            "persona", persona, "coach_model_arm", arm, "layer1_arm", layerArm, "layer1_used", Boolean.toString(!layerBlock.isEmpty()), "model_fallback", Boolean.toString(modelFallback), "coach_flow", flow, "coach_opening", opening, "already_arm", alreadyArm,
                            "stream", Boolean.toString(streaming), "video_reused", Boolean.toString(videoReused),
                            "video_omitted", Boolean.toString(videoOmitted),
                            "classify_ms", Long.toString(millis(startedNanos, classifiedNanos)),
                            "video_ms", Long.toString(millis(classifiedNanos, videoNanos)),
                            "warm_wait_ms", Long.toString(warmWaitNanos / 1_000_000),
                            "thinking", replyTrace.thinking(),
                            "thoughts_tokens", Integer.toString(replyTrace.thoughtsTokens()),
                            "candidates_tokens", Integer.toString(replyTrace.candidatesTokens()),
                            "reply_ms", Long.toString(millis(videoNanos, repliedNanos)),
                            "shorten_ms", Long.toString(millis(repliedNanos, System.nanoTime()))))
                    .withPrompt(template));
            LOG.info("coach turn timing practice={} first={} arm={} stream={} video_reused={} total_ms={} classify_ms={} "
                            + "video_ms={} warm_wait_ms={} reply_ms={} shorten_calls={} empty_retry={} video_omitted={} thinking={} "
                            + "thoughts_tokens={} candidates_tokens={}",
                    shortId(session.practiceSessionId()), session.turns().isEmpty(), arm, streaming, videoReused,
                    millis(startedNanos, System.nanoTime()), millis(startedNanos, classifiedNanos),
                    millis(classifiedNanos, videoNanos), warmWaitNanos / 1_000_000, millis(videoNanos, repliedNanos),
                    shortened, emptyRetry, videoOmitted, replyTrace.thinking(), replyTrace.thoughtsTokens(),
                    replyTrace.candidatesTokens());
            if (loop) DirectVideoPracticeLoop.remember(state, parsed);
            if (purpose != null && !cut) {
                if (purposeTurn == null) PurposeLoop.rememberOpening(state, purpose, purposeOut, parsed.design());
                else PurposeLoop.remember(state, purposeTurn, purposeOut, purposeTake);
            }
            if (cut) DirectVideoPracticeLoop.markNotActing(state, "model");
            if (loop && purpose == null) AnswerExamples.remember(state, cut ? java.util.List.of() : AnswerExamples.forReply(message, shown));
            // Plain coaching prose is not structured evidence or a confirmed actor intention.
            String endReason = actorFinished ? "actor_finished" : turnBudget ? "turn_budget"
                    : cut || loop && DirectVideoPracticeLoop.finished(parsed) || purposeTurn != null && purposeTurn.wrap() ? "interrupted" : null;
            CoachResult result = StructuredCoachEngine.result(session, actorText, shown, state, endReason);
            keepVideo = endReason == null;
            return result;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            failures.report(failure, inspecting ? FailureKind.UNEXPECTED : FailureKind.EXTERNAL,
                    new FailureContext(inspecting ? "DirectVideoCoach.inspect" : "DirectVideoCoach.turn", operationId));
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(),
                    speaker.model(), input, "", LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    failure.getClass().getSimpleName(), LlmCall.metadata("transport", "gemini_direct_video", "route", route,
                            "route_fallback", Boolean.toString(routeFallback), "coach_model_arm", arm, "coach_flow", flow,
                            "video_omitted", Boolean.toString(videoOmitted), "thinking", replyTrace.thinking(),
                            "thoughts_tokens", Integer.toString(replyTrace.thoughtsTokens()),
                            "candidates_tokens", Integer.toString(replyTrace.candidatesTokens()))).withPrompt(template));
            LOG.info("coach turn timing practice={} first={} arm={} failed={} total_ms={} classify_ms={} video_ms={} warm_wait_ms={} video_omitted={} thinking={} thoughts_tokens={}",
                    shortId(session.practiceSessionId()), session.turns().isEmpty(), arm, failure.getClass().getSimpleName(),
                    millis(startedNanos, System.nanoTime()), millis(startedNanos, classifiedNanos),
                    millis(classifiedNanos, videoNanos), warmWaitNanos / 1_000_000, videoOmitted,
                    replyTrace.thinking(), replyTrace.thoughtsTokens());
            throw new CoachReplyUnavailable();
        } finally {
            if (uploaded != null && keepVideo && videoCache.enabled()) {
                videoCache.keep(videoKey, uploaded);
            } else if (uploaded == null && videoOmitted && !keepVideo) {
                // 영상 없이 쓴 답으로 대화가 닫혔거나 답이 실패했다 — 기억해 둔 영상을 지운다.
                videoCache.forget(session.practiceSessionId());
            } else if (uploaded != null) {
                // 대화가 닫혔거나 답이 실패했다 — 기억한 영상과 이번 영상을 지운다.
                DirectVideoModel.Video forgotten = videoCache.forget(session.practiceSessionId());
                if (!CoachVideoCache.same(forgotten, uploaded)) {
                    try { model.delete(uploaded); }
                    catch (RuntimeException failure) {
                        failures.report(failure, FailureKind.EXTERNAL, new FailureContext("DirectVideoCoach.delete", operationId));
                    }
                }
            }
            if (local != null) {
                try { Files.deleteIfExists(local); }
                catch (java.io.IOException failure) {
                    failures.report(failure, new FailureContext("DirectVideoCoach.tempCleanup", operationId));
                }
            }
        }
    }

    /**
     * 이 대화의 코치 성격(SOMA-622). 저장된 값이 있으면 그대로, 첫 응답이면 배정을 묻는다.
     * 배정이 실패하면 기본 성격으로 간다 — 코칭은 멈추지 않는다.
     */
    private String persona(CoachSessionSnapshot session, UUID operationId) {
        String stored = DirectVideoPracticeLoop.storedPersona(session.coachingState());
        if (!stored.isEmpty() || !session.turns().isEmpty()) return stored;
        try {
            String assigned = personas.assign(session);
            assigned = assigned == null ? "" : assigned.strip();
            // 자문위원 파일이 먼저다. 없는 배우는 기억 갱신이 쓴 맞춤 코칭이 있으면 그것을 같은 자리에 받는다(SOMA-795).
            if (assigned.isEmpty() && !session.priorForModel().coachingProfile().isEmpty()) {
                return DirectVideoPrompts.ACTOR_PROFILE;
            }
            return assigned;
        } catch (RuntimeException failure) {
            failures.report(failure, FailureKind.UNEXPECTED, new FailureContext("DirectVideoCoach.persona", operationId));
            return "";
        }
    }

    /** B 흐름에서 코치가 본 것을 말하는 응답의 줄이기 기준 길이. */
    static final int TELL_REPLY = 90;

    /**
     * 이 대화의 코치 흐름(SOMA-636 A/B). 저장된 값이 있으면 그대로, 첫 응답이면 배정을 묻는다.
     * 배포 전에 시작한 대화(저장값 없음)와 배정 실패는 A다 — 코칭은 멈추지 않는다.
     */
    private String flow(CoachSessionSnapshot session, UUID operationId) {
        String stored = DirectVideoPracticeLoop.storedFlow(session.coachingState());
        if (!stored.isEmpty()) return stored;
        if (!session.turns().isEmpty()) return CoachFlows.A;
        try {
            String assigned = flows.assign(session);
            return CoachFlows.B.equals(assigned) ? CoachFlows.B : CoachFlows.A;
        } catch (RuntimeException failure) {
            failures.report(failure, FailureKind.UNEXPECTED, new FailureContext("DirectVideoCoach.flow", operationId));
            return CoachFlows.A;
        }
    }

    /**
     * 이 대화의 코치 모델 쪽(SOMA-657). 저장된 값이 있으면 그대로 쓴다. 첫 응답이면 연습 세션 id 로 정해
     * 같은 세션은 다시 시도해도 같은 쪽이 나온다. 배포 전에 시작한 대화(저장값 없음)는 기본 모델로 끝낸다.
     */
    String coachArm(CoachSessionSnapshot session) {
        String stored = DirectVideoPracticeLoop.storedCoachModel(session.coachingState());
        if (!stored.isEmpty()) return stored;
        if (!session.turns().isEmpty() || alternateShare <= 0 || session.practiceSessionId() == null) return "a";
        return Math.floorMod(session.practiceSessionId().hashCode(), 100) < alternateShare ? "b" : "a";
    }

    /**
     * 이 대화의 첫 말 쪽(첫 코칭 첫 말 A/B). 저장된 값이 있으면 그대로, 첫 응답이면 배정을 묻는다.
     * 한국어가 아니거나 이어서 하는 연습이면 묻지 않고 A 다. 배포 전에 시작한 대화(저장값 없음)와 배정 실패도 A 다.
     */
    String opening(CoachSessionSnapshot session, String actorText, UUID operationId) {
        String stored = DirectVideoPracticeLoop.storedOpening(session.coachingState());
        if (!stored.isEmpty()) return stored;
        if (!session.turns().isEmpty()) return CoachOpenings.A;
        java.util.Locale language = DirectVideoPracticeLoop.replyLanguage(session, actorText);
        if (language != null && !"ko".equals(language.getLanguage())) return CoachOpenings.A;
        if (session.priorForModel().earlierConversation() != null) return CoachOpenings.A;
        try {
            return CoachOpenings.B.equals(openings.assign(session)) ? CoachOpenings.B : CoachOpenings.A;
        } catch (RuntimeException failure) {
            failures.report(failure, FailureKind.UNEXPECTED, new FailureContext("DirectVideoCoach.opening", operationId));
            return CoachOpenings.A;
        }
    }

    static final String ALREADY_ON = "on";
    static final String ALREADY_OFF = "off";

    /**
     * 이 대화의 "이미 그렇게 했다" 처리 쪽(SOMA-855). 저장된 값이 있으면 그대로 쓴다. 첫 응답이면 연습 세션 id 로 정해
     * 같은 세션은 다시 시도해도 같은 쪽이 나온다. 모델 비교와 따로 나뉘게 id 에 꼬리를 붙여 섞는다. 배포 전에 시작한 대화는 off 다.
     */
    String alreadyArm(CoachSessionSnapshot session) {
        String stored = DirectVideoPracticeLoop.storedAlready(session.coachingState());
        if (!stored.isEmpty()) return stored;
        if (!session.turns().isEmpty() || alreadyShare <= 0 || session.practiceSessionId() == null) return ALREADY_OFF;
        return Math.floorMod((session.practiceSessionId() + ":already").hashCode(), 100) < alreadyShare ? ALREADY_ON : ALREADY_OFF;
    }

    /** 두 시각(System.nanoTime) 사이의 밀리초. 그 단계까지 가지 못했으면(끝이 0) -1 이다. */
    static long millis(long from, long to) {
        return to == 0 ? -1 : (to - from) / 1_000_000;
    }

    /** 로그용 짧은 회차 번호(앞 8자리). */
    static String shortId(UUID id) {
        String text = String.valueOf(id);
        return text.length() > 8 ? text.substring(0, 8) : text;
    }

    private DirectVideoModel coachModel(String arm) {
        return "b".equals(arm) && alternate != null ? alternate : model;
    }

    /** 이어서 찍은 회차의 받아 적기·두 번째 첫 답을 돌리는 곳. 요청 스레드를 막지 않게 가상 스레드를 쓴다. */
    private static final java.util.concurrent.ExecutorService SIDE_CALLS = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();
    /** 기본 첫 답이 나온 뒤 곁가지 호출을 더 기다리는 최대 시간. 넘으면 기본 첫 답을 쓴다. */
    static final long SIDE_WAIT_SECONDS = 15;

    private static String awaitSide(java.util.concurrent.Future<String> future, long seconds) {
        if (future == null) return null;
        try {
            return future.get(seconds, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            future.cancel(true);
            return null;
        } catch (java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException notReady) {
            future.cancel(true);
            return null;
        }
    }

    private static String personaBlock(String persona, String profile, java.util.Locale language) {
        String text = DirectVideoPrompts.persona(persona, language, profile);
        return text.isEmpty() ? "" : "\n\n" + text;
    }

    /**
     * 코치 AI 호출. 연습 루프에서는 빈 응답("empty video coaching reply")을 오류로 끝내지 않고 {@code null}로 돌려
     * 한 번 다시 쓰게 한다. 다른 실패는 그대로 던진다.
     */
    /** {@link #replyOrNull} 의 스트리밍판. 보일 글만 {@code visible} 로 흘려보낸다. */
    private static String streamOrNull(DirectVideoModel speaker, DirectVideoModel.Video video,
            java.util.List<DirectVideoModel.Message> history, String prompt, VisibleCoachText visible, ReplyTrace trace) {
        visible.restart();
        try {
            String reply = trace.run(() -> speaker.replyStream(video, history, prompt, visible::accept));
            return reply == null || reply.isBlank() ? null : reply;
        } catch (VisibleCoachText.Broken broken) {
            // 깨진 글을 끝까지 흘리지 않고 끊었다. 깨진 글을 돌려주면 부르는 쪽의 깨진 글 검사가 다시 쓰게 한다.
            return broken.text();
        } catch (IllegalStateException empty) {
            if (String.valueOf(empty.getMessage()).contains("empty")) return null;
            throw empty;
        }
    }

    /** 빈 답 세 번째 시도는 이 시간 안에서만 한다. 앱 요청 한도 60초(api-request.ts)보다 넉넉히 짧게 둔다. */
    static final Duration LIGHT_RETRY_BUDGET = Duration.ofSeconds(40);

    private static String lightOrNull(DirectVideoModel speaker, DirectVideoModel.Video video,
            java.util.List<DirectVideoModel.Message> history, String prompt, ReplyTrace trace) {
        try {
            String reply = trace.run(() -> speaker.replyLight(video, history, prompt));
            return reply == null || reply.isBlank() ? null : reply;
        } catch (IllegalStateException empty) {
            if (String.valueOf(empty.getMessage()).contains("empty")) return null;
            throw empty;
        }
    }

    private static String replyOrNull(DirectVideoModel speaker, DirectVideoModel.Video video,
            java.util.List<DirectVideoModel.Message> history, String prompt, boolean loop, ReplyTrace trace) {
        try {
            String reply = trace.run(() -> speaker.reply(video, history, prompt));
            return reply == null || reply.isBlank() ? null : reply;
        } catch (IllegalStateException empty) {
            if (loop && String.valueOf(empty.getMessage()).contains("empty")) return null;
            throw empty;
        }
    }

    /** 배우가 "다른 피드백", "또 다른 건"처럼 앞과 다른 것을 달라고 했는지. */
    static boolean asksForAnother(String actorText) {
        return actorText != null && actorText.matches("(?s).*(다른|또 |또다른|딴).*") && actorText.strip().length() <= 30;
    }

    /** "맞아요"로 받아도 되는 배우 말(단계 질문에 답한 말·짧은 답). 반박·정정·물음·요청에는 붙이지 않는다. */
    static boolean agreeable(PracticeLoopRouter.Kind kind) {
        return switch (kind) {
            case PUSHBACK, CORRECTION, QUESTION, EVALUATION, METHOD, MISSED -> false;
            default -> true;
        };
    }

    /** 서버가 정한 이번 응답. 상태 칸과 모델에 줄 지시를 만든다. */
    private record Branch(PracticeLoopRouter.Classified classified, PracticeLoopRouter.Before before, String doing,
            String goal, java.util.List<String> avoid, String observed, String dialogue, boolean closeNext,
            String actorText, java.util.List<String> materials, String rootField, String flow, String done) {

        /** 배우가 이유·방법·예시·설명·피드백을 달라고 해서 답하는 말인지. 길이 제한을 늘린다. */
        boolean explains() {
            boolean answering = doing.startsWith("답하기") || doing.startsWith("짚어주기");
            var kind = classified.kind();
            boolean asked = kind == PracticeLoopRouter.Kind.QUESTION || kind == PracticeLoopRouter.Kind.EVALUATION
                    || kind == PracticeLoopRouter.Kind.METHOD || classified.alsoAsked();
            return answering && asked;
        }

        String instruction(java.util.Locale language, String task) {
            // 쉽게 묻기는 이번에 알아낼 것(다음 단계의 목표)을 함께 준다.
            String withGoal = PracticeLoopRouter.EASY.equals(doing) ? task + "\n  이번에 알아낼 것: " + PracticeLoopRouter.easyGoal(before) : task;
            // 첫 응답이 찾은 근본 문제와 그 문제를 푸는 길을 매 턴 함께 준다.
            String root = DirectVideoPrompts.practiceLoopRoot(rootField, language);
            if (!root.isEmpty()) withGoal = withGoal + "\n\n" + root;
            // 정리 뒤 한 번 답하는 말이면 단계 질문으로 돌아가지 않는다 — 배우가 답하면 바로 닫히기 때문이다.
            // 정리 뒤 내려놓기는 마지막 말이 아니다. 배우 해석을 묻는 질문이라 "질문하지 않는다"는 마지막 말 지시를 붙이지 않는다.
            boolean lastWord = closeNext && !PracticeLoopRouter.LET_GO.equals(doing) && !PracticeLoopRouter.ASK_DONE.equals(doing);
            // 실험 쪽(SOMA-855)에서 정리 뒤 또 이미 했다고 하면, 배우 해석을 따르라는 마지막 말 대신 같은 제안 없이 받아들이고 닫는다.
            boolean doneLast = lastWord && done != null && !done.isBlank() && !doing.startsWith(PracticeLoopRouter.WRAP_UP);
            String stage = doneLast ? doneLastWordLine(language) : lastWord ? lastWordLine(language, classified.kind())
                    : PracticeLoopRouter.stageLine(doing, before, flow);
            return PracticeLoopRouter.instruction(language, doing, avoid, observed, dialogue, withGoal, stage, materials);
        }

        /** 배우가 4단계에서 대안을 말했는지(재료에 찾은 대안이 들어갔는지). */
        boolean actorFoundAlternative() {
            return materials.stream().anyMatch(line -> line.startsWith("배우가 말한 찾은 대안"));
        }

        String status() {
            return status("");
        }

        /**
         * 정리 뒤 마지막 답인지. 배우가 정리와 다른 해석을 냈으면 모델이 숨은 줄 &lt;다음 테이크&gt;에 배우 해석의 행동을 쓰고,
         * 그 줄이 있으면 노트의 다음 촬영을 덮는다. 다른 해석인지는 분류(반박·정정·물음·판단 요청)에 기대지 않고 모델이 본다
         * — "저는 조용히 협박하는 인물이라고 봤어요"는 반박으로 분류되지 않았다(dev 시험 2026-10-11).
         */
        boolean acceptsReading() {
            return closeNext;
        }

        private static String doneLastWordLine(java.util.Locale language) {
            boolean korean = language == null || "ko".equals(language.getLanguage());
            if (!korean) {
                return "this is the last thing you say today. The actor says they already did the suggestion in the material line."
                        + " Do not repeat it or reword it. Accept in one sentence that they did it. If one line in the video still came through less, name"
                        + " that one line as you saw it and suggest listening for it in the next take. Do not give a new action, do not ask a question,"
                        + " and do not write a hidden line.";
            }
            return "이번이 오늘 대화의 마지막 말이다. 배우는 재료의 제안을 이미 그렇게 했다고 했다. 그 제안을 다시 하거나 같은 뜻의 다른 말로 바꿔 하지 않는다."
                    + " 배우가 그렇게 했다는 것을 한 문장으로 받아들인다. 영상에서 아직 덜 들린 대사가 있으면 하나만 본 그대로 말하고, 다음 테이크에서 그 대사를 들어 보자고 한다."
                    + " 새 행동을 제안하지 않는다. 질문하지 않는다. 숨은 줄은 쓰지 않는다. 아래 모양 칸의 \"질문\"은 이번에는 쓰지 않는다.";
        }

        private static String lastWordLine(java.util.Locale language, PracticeLoopRouter.Kind kind) {
            boolean korean = language == null || "ko".equals(language.getLanguage());
            boolean disagreed = kind == PracticeLoopRouter.Kind.PUSHBACK || kind == PracticeLoopRouter.Kind.CORRECTION;
            // 물음이 아니라 생각을 덧붙인 말(정리 뒤 "그저 화풀이니까 더 크게 화를 내야")이면 답이 아니라 받아 주기다.
            boolean asked = kind == PracticeLoopRouter.Kind.QUESTION || kind == PracticeLoopRouter.Kind.EVALUATION
                    || kind == PracticeLoopRouter.Kind.METHOD;
            if (!korean) {
                return "this is the last thing you say today. "
                        + (asked || disagreed ? "Answer in one or two sentences" : "Take up what the actor just said in one or two sentences")
                        + " and do not ask any question."
                        + (disagreed ? " The actor offered a different reading." : " If the actor offered a different reading of the character or a different action from your wrap-up:")
                        + " follow the actor's reading this time and do not go back to your earlier suggestion."
                        + " Write a hidden first line <다음 테이크>…</다음 테이크> with one action that follows the actor's reading, then say that action as"
                        + " \"you could try …\" and suggest checking in the next take whether it works. Do not give orders."
                        + (disagreed ? "" : " If the actor only asked something, just answer and do not write the hidden line.");
            }
            return "이번이 오늘 대화의 마지막 말이다. "
                    + (asked || disagreed ? "물은 것에 한두 문장으로 답만 하고" : "배우가 방금 한 말을 한두 문장으로 받아 주고")
                    + " 질문하지 않는다. 아래 모양 칸의 \"질문\"은 이번에는 쓰지 않는다."
                    + (disagreed ? " 배우가 정리에 다른 해석을 냈다." : " 배우가 정리와 다른 인물 해석이나 다른 행동을 냈으면(\"저는 ~한 인물이라고 봤어요\", \"~하는 게 맞다고 생각했어요\"):")
                    + " 이번에는 배우의 해석을 따른다. 앞서 코치가 한 제안이나 근본 문제로 돌아가지 않는다."
                    + " 맨 첫 줄에 숨은 줄 <다음 테이크>…</다음 테이크>를 쓰고, 안에는 배우의 해석대로 다음 테이크에서 해 볼 행동 하나를 \"~해 봐도 좋아요\"로 끝나는 한 문장으로 쓴다(노트에 남는다. \"그 해석이면\" 같은 앞말 없이 행동만)."
                    + " 그다음 줄부터 그 행동을 \"~해 봐도 좋아요\"로 말하고, 그게 장면에서 통하는지 다음 테이크에서 확인해 보자고 한다."
                    + " \"~하세요\", \"~보여 주세요\", \"~해 봐요\"처럼 시키지 않는다. 예) 그 해석이면 소리 지르며 따져 봐도 좋아요. 다음 테이크에서 통하는지 확인해 봐요."
                    + (disagreed ? "" : " 배우가 묻기만 했으면 답만 하고 숨은 줄은 쓰지 않는다.");
        }

        /** 정리하기면 숨은 줄의 다음 테이크를 남긴다 — 노트의 다음 촬영이 이것을 쓴다. */
        String status(String nextTake) {
            String status = PracticeLoopRouter.status(observed, dialogue, classified, before, doing, goal, avoid,
                    nextTake == null ? "" : nextTake.strip(), closeNext, actorText);
            return done == null || done.isBlank() ? status : status + "\n" + PracticeLoopRouter.DONE_FIELD + ": " + done;
        }
    }

    /** 목적별 코칭의 이번 응답(SOMA-719). 버튼을 그대로 눌렀으면 분류 AI를 부르지 않는다. */
    private PurposeLoop.Turn purposeTurn(CoachSessionSnapshot session, PurposeLoop.Purpose purpose, String actorText,
            boolean actorFinished, UUID operationId) {
        if (actorFinished) return PurposeLoop.ended(purpose, session.coachingState());
        int replies = (int) session.turns().stream().filter(t -> "ai".equals(t.role())).count();
        String pressed = PurposeLoop.pressed(session.coachingState(), actorText);
        PracticeLoopRouter.Classified classified = pressed == null ? classify(session, actorText, operationId) : null;
        return PurposeLoop.decide(purpose, session.coachingState(), actorText, pressed, classified, replies);
    }

    private Branch branch(CoachSessionSnapshot session, String actorText, UUID operationId, String flow, ActorCoaching coaching,
            String alreadyArm) {
        var loopState = session.coachingState() == null ? null : session.coachingState().path(DirectVideoPracticeLoop.STATE_KEY);
        int coachTurns = (int) session.turns().stream().filter(t -> "ai".equals(t.role())).count();
        var before = PracticeLoopRouter.before(loopState, coachTurns);
        var classified = PracticeLoopRouter.forRouting(classify(session, actorText, operationId), before);
        String design = loopState == null ? "" : loopState.path("design").asText("");
        int stayed = PracticeLoopRouter.stayed(loopState, coachTurns);
        String doing = PracticeLoopRouter.route(classified, before, stayed, flow,
                coaching == null ? null : coaching.maxQuestions(), PracticeLoopRouter.questionsAsked(loopState, coachTurns));
        // SOMA-855 실험 쪽: 배우가 이미 그렇게 했다고 하면 의도를 다시 묻지 않고 한 일을 묻고, 그다음 다른 행동으로 정리한다.
        boolean alreadyOn = ALREADY_ON.equals(alreadyArm);
        if (alreadyOn) doing = PracticeLoopRouter.routeAlready(classified, before, doing, PracticeLoopRouter.askedDone(loopState, coachTurns),
                PracticeLoopRouter.lastWasDone(loopState, coachTurns));
        String done = alreadyOn && classified.already() ? PracticeLoopRouter.lastProposal(loopState, coachTurns, lastCoachText(session)) : "";
        var avoid = PracticeLoopRouter.avoidAfter(before, classified.kind(), DirectVideoPracticeLoop.habit(design));
        String goal = DirectVideoPracticeLoop.goal(loopState == null ? null : loopState.path("statuses"), design);
        var materials = withTries(withContinuity(materials(design, PracticeLoopRouter.answers(loopState, coachTurns), classified, before, actorText, doing,
                PracticeLoopRouter.latestWant(loopState, coachTurns), PracticeLoopRouter.lineFixed(loopState, coachTurns)),
                session, design, doing),
                doing, stayed, session);
        if (alreadyOn) materials = PracticeLoopRouter.withDone(materials, PracticeLoopRouter.doneProposals(loopState, coachTurns), done);
        boolean closeNext = PracticeLoopRouter.closesNext(classified, before) && !PracticeLoopRouter.ASK_DONE.equals(doing);
        return new Branch(classified, before, doing, goal, avoid, DirectVideoPracticeLoop.statusField(design, "관찰 근거"),
                DirectVideoPracticeLoop.statusField(design, "대사 확인"), closeNext,
                actorText, materials,
                DirectVideoPracticeLoop.statusField(design, "근본 문제"), flow, done);
    }

    /** 바로 앞 코치 말. 없으면 빈 문자열. */
    private static String lastCoachText(CoachSessionSnapshot session) {
        var turns = session.turns();
        for (int i = turns.size() - 1; i >= 0; i--) if ("ai".equals(turns.get(i).role())) return turns.get(i).text();
        return "";
    }

    /**
     * 비유를 본 그대로의 말로 바꾸고 반복한 질문을 다른 질문으로 바꾸는 가벼운 호출(영상 없음). 고친 결과가 여전히 비유·반복이거나
     * 비었거나 깨졌거나 근거 검사를 못 넘으면 {@code null}.
     */
    private String polish(String text, java.util.List<String> figures, String repeated, java.util.List<String> said,
            java.util.List<String> earlier, String actorWords,
            java.util.Locale language, DirectVideoModel.Video video, String written, UUID operationId) {
        if (DirectVideoPracticeLoop.looksBroken(text, language)) return null;
        var notes = new StringBuilder();
        if (!figures.isEmpty()) notes.append("\n- 고칠 비유: ").append(String.join(", ", figures));
        if (!said.isEmpty()) notes.append("\n- 바로 앞에서 이미 한 말(그대로 되풀이하지 않는다): ").append(String.join(" / ", said));
        if (!repeated.isEmpty() || !said.isEmpty()) {
            if (!repeated.isEmpty()) notes.append("\n- 이미 한 질문: ").append(repeated);
            // 바꾼 질문이 배우가 이미 아니라고 한 해석으로 돌아가지 않게 배우의 최근 말을 준다(2026-10-21 재생: "줄려고 하면 안돼" 뒤에 "설득하려면"으로 바꿨다).
            var lines = actorWords.strip().lines().filter(l -> !l.isBlank()).toList();
            String recent = String.join(" / ", lines.subList(Math.max(0, lines.size() - 3), lines.size()));
            if (!recent.isBlank()) notes.append("\n- 배우가 최근에 한 말(바꾼 질문이 이 말과 어긋나거나 배우가 아니라고 한 해석으로 돌아가지 않게 한다): ").append(recent);
        }
        try {
            ExternalOperationExecution.externalCall("model");
            String raw = model.replyLight(null, java.util.List.of(new DirectVideoModel.Message("user", text)),
                    DirectVideoPrompts.practiceLoopPolish(language) + notes);
            if (raw == null || raw.isBlank()) return null;
            String better = DirectVideoPracticeLoop.parse(raw).message();
            if (DirectVideoPracticeLoop.hasTimestamp(better)) better = DirectVideoPracticeLoop.stripTimestamps(better);
            if (better.isBlank() || DirectVideoPracticeLoop.looksBroken(better, language)) return null;
            if (!DirectVideoPracticeLoop.metaphors(better, actorWords).isEmpty()) return null;
            if (!DirectVideoPracticeLoop.repeatedQuestion(better, earlier).isEmpty()) return null;
            if (!DirectVideoPracticeLoop.repeatedLines(better, earlier).isEmpty()) return null;
            DirectVideoDialogueEvidence.requireGrounded(video, better, written);
            return better;
        } catch (IllegalStateException | IllegalArgumentException rejected) {
            return null;
        } catch (RuntimeException failure) {
            if (Thread.currentThread().isInterrupted()) throw failure;
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("DirectVideoCoach.polish", operationId));
            return null;
        }
    }

    /**
     * 긴 코치 말을 줄이기만 하는 호출(영상 없음). 뜻과 마지막 질문은 그대로 두고 50자 안쪽으로 다시 쓰게 한다.
     * 줄지 않았거나 비었거나 근거 검사를 못 넘으면 {@code null} — 부르는 쪽이 원래 말을 그대로 쓴다.
     */
    private String shorten(String text, java.util.Locale language, String persona, String profile, DirectVideoModel.Video video, String written, UUID operationId) {
        // 코치 말로 보이지 않는 글은 줄이지 않는다. 줄이면 엉뚱한 글이 그럴듯한 한국어 한 줄이 되어 버린다.
        if (DirectVideoPracticeLoop.looksBroken(text, language)) return null;
        try {
            ExternalOperationExecution.externalCall("model");
            // 줄이기는 생각을 거의 하지 않게 부른다(SOMA-780, 10/21 실측 6.0초 → 1.3초).
            String raw = model.replyLight(null, java.util.List.of(new DirectVideoModel.Message("user", text)),
                    DirectVideoPrompts.practiceLoopShorten(language) + DirectVideoPrompts.personaShortenNote(persona, language, profile));
            if (raw == null || raw.isBlank()) return null;
            String shorter = DirectVideoPracticeLoop.parse(raw).message();
            if (DirectVideoPracticeLoop.hasTimestamp(shorter)) shorter = DirectVideoPracticeLoop.stripTimestamps(shorter);
            if (shorter.isBlank() || DirectVideoPracticeLoop.displayLength(shorter) >= DirectVideoPracticeLoop.displayLength(text)) return null;
            if (DirectVideoPracticeLoop.looksBroken(shorter, language)) return null;
            DirectVideoDialogueEvidence.requireGrounded(video, shorter, written);
            return shorter;
        } catch (IllegalStateException | IllegalArgumentException rejected) {
            return null;
        } catch (RuntimeException failure) {
            if (Thread.currentThread().isInterrupted()) throw failure;
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("DirectVideoCoach.shorten", operationId));
            return null;
        }
    }

    /** 이번 응답의 재료. 관찰 메모에서 버릇·가리는 것·살아 있는 곳·인물을, 상태 칸에서 배우가 단계마다 한 말을 꺼낸다. */
    /**
     * 같은 단계에 머물러 다시 물을 때, 이 단계에서 이미 한 코치 말과 이번이 몇 번째인지 준다.
     * 같은 프롬프트로 같은 질문을 되풀이하지 않게 하려는 것이다.
     */
    /**
     * 배우가 이번 연습을 올리며 적은 말과, 같은 장면을 이어 찍은 회차의 지난 제안을 매 턴 재료로 준다.
     *
     * <p>2026-10-22 운영(일반 배우, 같은 장면 3회): 배우가 막힌 곳에 "첫 대사는 놀리면서 시작하고 싶었어"라고 적었는데
     * 첫 응답 뒤로는 재료에 없어 "혼자 추억에 젖은 듯"으로 진단했다. 아빠 장면은 세 회차 모두 "따져 묻기·몰아붙이기"로
     * 정리했고 노트 제목도 세 번 같았다. 배우가 "다시 집중됐어"라고 지난 시도의 변화를 말해도 "그것만 보여요"로 받았다.
     * 지난 제안은 첫 응답의 [이어서 하는 연습] 칸에만 있어 둘째 응답부터는 코치가 몰랐다.
     */
    static java.util.List<String> withContinuity(java.util.List<String> materials, CoachSessionSnapshot session,
            String design, String doing) {
        var lines = new java.util.ArrayList<>(materials);
        String written = session.blockageDetail();
        if (written != null && !written.isBlank()) {
            lines.add("배우가 이번 연습을 올리며 적은 것: " + written.replaceAll("\\s+", " ").strip());
            lines.add("배우가 적은 것에 이 장면에서 하려던 것(놀리기, 버티기 같은 선택)이 있으면 그건 배우의 선택이다. "
                    + "그 선택을 다른 해석으로 바꿔 문제 삼지 않고, 제안·정리는 그 선택을 살리는 쪽으로 한다");
        }
        String lastTry = continuedSuggestion(session, design);
        if (lastTry == null) return lines;
        lines.add("지난 회차 제안(배우가 이번 테이크에서 해 보려던 것): " + lastTry);
        if (PracticeLoopRouter.GAP.equals(doing)) {
            lines.add("배우가 지난 시도로 달라진 점(예: \"다시 집중됐어\", \"더 설렜어\")을 말했으면 맨 앞에 그 변화를 배우 낱말 그대로 짧게 받아 준다"
                    + "(예: 기다리니까 다시 집중됐군요.). 그 한마디를 붙이면 80자 안쪽까지 써도 된다. 지난 시도 자체나 지난 제안대로 한 모습을"
                    + " \"~만 보여요\"로 문제 삼지 않는다. 문제는 지난 시도를 하고도 남은 것으로 보여 준다");
        }
        var used = actionFamilies(lastTry);
        if (!used.isEmpty()) {
            lines.add("지난 회차에 이미 권한 행동: " + String.join(", ", used) + ". 이번 응답의 제안·정리에서는 이 말과 같은 묶음의 말을 쓰지 않는다."
                    + " 배우가 이번 대화에서 그 말을 직접 다시 꺼냈을 때만 배우 말로 쓴다");
        }
        lines.add("이번에 권하는 행동은 지난 회차 제안과 같은 행동(같은 동사, 같은 말)이면 안 된다. 지난 시도는 이미 해 봤다. "
                + "지난 시도 위에 이번 대화에서 배우가 새로 말한 바람·감정·느낌 낱말을 그대로 넣어 한 걸음 나아간 행동으로 준다"
                + "(다른 영상 예: 지난 제안 \"떠보기\" + 배우가 새로 말한 \"사실 무서워\" → 무서운 걸 들키지 않으려고 웃으며 떠봐도 좋아요)");
        return lines;
    }

    /**
     * 제안에 든 행동을 묶음 이름(낱말 보기)으로. 같은 묶음의 다른 말("몰아붙이기"·"몰아세우기")로 바꿔 되풀이하는 것을 막는다.
     * 2026-10-22 재생: 지난 제안을 다시 주지 말라는 줄만으로는 아빠 장면 6번 중 5번이 "몰아붙이기·따지기"로 돌아갔다.
     */
    private static final java.util.List<String[]> ACTION_FAMILIES = java.util.List.of(
            new String[] {"몰아붙이기(몰아붙이다·몰아세우다·쏘아붙이다·다그치다)", "몰아붙", "몰아세", "쏘아붙", "다그치", "몰아치", "밀어붙"},
            new String[] {"따지기(따지다·조목조목·캐묻다·추궁하다)", "따지", "따져", "조목조목", "캐묻", "캐물", "추궁"},
            new String[] {"빤히 보기(빤히·쳐다보다·눈을 보다)", "빤히", "쳐다보", "쳐다봐", "뚫어지게", "눈을 떼지", "눈을 안 떼"},
            new String[] {"반응 확인하기(확인하며·살피며)", "확인하며", "확인하고", "살피며", "살피고"},
            new String[] {"놀리기", "놀리", "놀려"},
            new String[] {"달래기", "달래"},
            new String[] {"매달리기(매달리다·붙잡다)", "매달리", "매달려", "붙잡"},
            new String[] {"떠보기", "떠보", "떠봐"},
            new String[] {"밀어내기", "밀어내"},
            new String[] {"하소연하기", "하소연"},
            new String[] {"설득하기", "설득"});

    static java.util.List<String> actionFamilies(String suggestion) {
        var found = new java.util.ArrayList<String>();
        if (suggestion == null) return found;
        for (String[] family : ACTION_FAMILIES) {
            for (int i = 1; i < family.length; i++) {
                if (suggestion.contains(family[i])) { found.add(family[0]); break; }
            }
        }
        return found;
    }

    /** 같은 장면을 이어 찍은 회차면 바로 앞 회차의 다음 테이크 제안. 이어 찍은 회차가 아니거나 제안이 없으면 null. */
    static String continuedSuggestion(CoachSessionSnapshot session, String design) {
        String shape = DirectVideoPracticeLoop.statusField(design, "첫 질문 모양");
        if (shape == null || !shape.strip().startsWith("이어서")) return null;
        PriorContext prior = session.prior();
        if (prior == null || prior.sceneHistory().isEmpty()) return null;
        String last = prior.sceneHistory().getLast();
        int at = last.lastIndexOf(" — 제안: ");
        if (at < 0) return null;
        String suggestion = last.substring(at + " — 제안: ".length()).strip();
        return suggestion.isEmpty() ? null : suggestion;
    }

    private static java.util.List<String> withTries(java.util.List<String> materials, String doing, int stayed, CoachSessionSnapshot session) {
        var coach = session.turns().stream().filter(t -> "ai".equals(t.role())).map(t -> t.text().replaceAll("\\s+", " ")).toList();
        var lines = new java.util.ArrayList<>(materials);
        // 단계를 넘기든 머물든, 앞에서 한 질문을 같은 뜻으로 다시 묻지 않게 최근 질문을 준다(2026-10-21 재생: 같은 질문 두 번 연달아).
        var asked = coach.stream().skip(Math.max(0, coach.size() - 3)).map(DirectVideoPracticeLoop::lastQuestion).filter(q -> !q.isEmpty()).toList();
        if (!asked.isEmpty()) lines.add("코치가 앞에서 이미 한 질문(같은 뜻으로 다시 묻지 않는다. 같은 걸 알아야 하면 다른 쪽에서 묻거나 질문 없이 끝낸다): " + String.join(" / ", asked));
        if (!PracticeLoopRouter.STAYS.contains(doing)) return lines;
        lines.add("이 단계에서 이번이 " + (stayed + 2) + "번째 응답이다. 앞의 코치 말은 배우에게 통하지 않았다. 같은 말, 같은 모양으로 다시 묻지 않는다");
        // 2026-10-21 재생: "지금 연기는 괜찮았어?", "내 실력은 어느정도야", "붙을 수 있어?"에 같은 피드백 세 문장이 네 번 그대로 나갔다.
        if ("짚어주기".equals(doing) || "답하기".equals(doing)) {
            lines.add("앞에서 한 판단·대사·제안 문장을 그대로 되풀이하지 않는다. 배우가 이번에 새로 물은 것(괜찮았는지, 실력이 어느 정도인지, 합격할 수 있는지 등)에만 맞춰 답한다. 영상으로 알 수 없는 것은 그렇다고 짧게 말한다");
        }
        for (int i = Math.max(0, coach.size() - stayed - 1); i < coach.size(); i++) lines.add("이 단계에서 이미 한 코치 말: " + coach.get(i));
        return lines;
    }

    private static java.util.List<String> materials(String design, java.util.Map<String, String> answers,
            PracticeLoopRouter.Classified classified, PracticeLoopRouter.Before before, String actorText, String doing,
            String storedWant, boolean storedLineFix) {
        var lines = new java.util.ArrayList<String>();
        java.util.function.BiConsumer<String, String> add = (label, value) -> {
            if (value != null && !value.isBlank() && !value.startsWith("없음")) lines.add(label + ": " + value.strip());
        };
        // 배우가 코치가 짚은 대사를 다른 장면이라고 바로잡았으면(2026-10-13 18:59 "그건 교수 흉내 부분이야") 그 대사를 정리에 다시 쓰지 않게 뺀다.
        boolean lineFixed = storedLineFix || classified.lineFix();
        if (lineFixed) {
            lines.add("배우가 코치가 짚은 대사를 다른 장면이라고 바로잡았다. 처음 고른 확인할 대사는 쓰지 않는다. 정리에서는 이 영상에서 들린 다른 대사를 쓰거나, 마땅한 대사가 없으면 대사 없이 행동만 말한다");
        } else {
            add.accept("정리에서 확인할 대사", DirectVideoPracticeLoop.statusField(design, "확인할 대사"));
        }
        add.accept("이 배우의 문제", DirectVideoPracticeLoop.statusField(design, "버릇"));
        add.accept("왜 이 배우의 문제인가", DirectVideoPracticeLoop.statusField(design, "왜 이 배우의 문제인가"));
        add.accept("버릇이 가리는 것", DirectVideoPracticeLoop.statusField(design, "버릇이 가리는 것"));
        add.accept("다른 쪽 살아 있는 곳", DirectVideoPracticeLoop.statusField(design, "다른 쪽 살아 있는 곳"));
        add.accept("인물", DirectVideoPracticeLoop.statusField(design, "인물"));
        // 독백(자기 자신·그 자리에 없는 사람에게 하는 말)이면 둘째 응답부터도 "상대"를 전제로 묻지 않게 한다.
        add.accept("말 거는 대상", DirectVideoPracticeLoop.statusField(design, "말 거는 대상"));
        var known = new java.util.LinkedHashMap<>(answers);
        String field = PracticeLoopRouter.answerField(classified, before);
        if (field != null && actorText != null) known.put(field, actorText.strip()); // 방금 답한 단계 답도 재료로
        known.forEach((label, value) -> add.accept("배우가 말한 " + label, value));
        // 배우가 바람을 새로 말하거나 고쳐 말했으면 첫 답보다 이 말이 기준이다. 4단계에서는 행동이 아니라서 단계 답으로 남지 않던 말이다.
        String want = classified.want() && actorText != null && !actorText.isBlank() ? actorText : storedWant;
        if (want != null && !want.isBlank()) {
            add.accept("배우가 가장 나중에 말한 바람", want.replaceAll("\\s+", " "));
            lines.add("바람은 첫 답보다 이 말이 기준이다. 바람을 다시 짐작해 묻지 않는다. 제안·정리의 행동은 이 바람을 얻는 쪽으로, 배우 낱말 그대로 잇는다. \"위로\"를 \"설득\"처럼 코치 낱말로 바꾸거나, 받고 싶은 쪽(상대가 나를 달래 주기)을 하는 쪽(상대를 달래기)으로 뒤집지 않는다. 코치가 앞서 질문이나 보기로 꺼낸 낱말은 배우 말이 아니다");
            // 2026-10-14 재생: 바람이 이미 있는데도 답 제안이 "저는 ~로 봤어요. 맞아요?"로 바람을 다시 짐작했다(할 일 파일의 모양이 이겼다).
            if (PracticeLoopRouter.PROPOSE.equals(doing)) {
                lines.add("이번 제안은 위 할 일의 모양·좋은 예보다 이 줄이 먼저다. 바람은 이미 나왔으니 \"저는 ~로 봤어요\"로 바람을 짐작하지 않는다. 그 바람을 배우 낱말 그대로 앞에 두고, 그걸 얻으려고 상대에게 해 볼 행동 하나를 제안한 뒤 \"어때요?\"로 묻는다. 모양: \"〈배우의 바람〉이면, 〈이 장면에서 상대에게 하는 행동〉해 봐도 좋아요. 어때요?\" 꺾쇠 안은 이 대화의 말로 바꾸고 꺾쇠는 쓰지 않는다");
            }
        }
        add.accept("배우가 방금 한 말", actorText == null ? null : actorText.replaceAll("\\s+", " "));
        if (classified.kind() == PracticeLoopRouter.Kind.METHOD && PracticeLoopRouter.GAP.equals(doing)) {
            lines.add("배우가 방법을 물었다. 방법을 말하기 전에, 무엇을 고쳐야 하는지부터 이번 단계로 보여 준다. 다음 질문에서 배우가 방법을 함께 찾는다");
        }
        switch (classified.respond()) {
            case "evaluation" -> lines.add("배우가 답하면서 코치의 판단도 물었다. 첫 문장에서 판단을 먼저 분명히 말하고(괜찮아요 / 조금 어색해요 / 아쉬워요), 이유는 근본 문제에 비춰 짧게 댄 뒤 이번 단계를 한다");
            case "question" -> lines.add("배우가 답하면서 물은 것이 있다. 첫 문장에서 쉬운 말로 바로 답하고, 이어서 이번 단계를 한다");
            case PracticeLoopRouter.WHY -> lines.add("배우가 코치가 왜 그렇게 봤는지, 어디서 그렇게 보였는지 근거를 물었다. 이번 할 일의 모양보다 이 줄이 먼저다. "
                    + "첫 문장은 영상의 어느 대사(대사가 확인 안 됐으면 어느 동작)에서 무엇이 보이거나 들려서 그렇게 봤는지다. 둘째 문장은 그게 이 장면에서 왜 걸리는지다. "
                    + "배우가 \"왜 내 방식은 안 돼요?\"라고 물었으면 배우 방식이 되는지 안 되는지를 먼저 분명히 말하고 이유를 댄다. 근거가 약하면 그렇다고 인정한다. "
                    + "다음 테이크 제안(\"~해 봐도 좋아요\")이나 질문으로 근거를 대신하지 않는다. 같은 근거를 이미 말했으면 다른 대사로 말한다");
            case "method" -> lines.add("배우가 답하면서 방법도 물었다. 방법은 이번 단계에서 배우와 함께 찾는다. 짧게 받고 이번 단계를 한다");
            default -> { }
        }
        if (PracticeLoopRouter.WRAP_UP.equals(doing) && !known.containsKey("찾은 대안")) {
            lines.add("배우가 찾은 대안: 아직 없음. \"맞아요, 그거예요\"로 인정하지 말고, 근본 문제를 푸는 길 4단계와 배우의 첫 답을 살리는 행동 하나를 코치가 제안한다");
        }
        // 2026-10-21 재생: "다른 피드백은", "또 다른건", "다른검"에 같은 피드백이 글자 그대로 세 번 나갔다.
        if ("짚어주기".equals(doing) && asksForAnother(actorText)) {
            lines.add("배우가 앞에서 들은 것 말고 다른 피드백을 달라고 했다. 이 줄이 할 일의 모양보다 먼저다. 앞에서 코치가 짚은 대사·잘 된 곳·아쉬운 곳·제안은 다시 쓰지 않고, "
                    + "이 영상의 다른 대사에서 새로 고른다. 새로 말할 만한 곳이 없으면 앞에서 말한 것이 가장 크다고 솔직히 짧게 말한다");
        }
        if (PracticeLoopRouter.WRAP_UP.equals(doing) && before.lastDoing().startsWith(PracticeLoopRouter.LET_GO)) {
            lines.add("배우가 앞의 정리를 아니라고 하고 자기 해석을 말했다. 이 줄이 위 줄들보다 먼저다. 정리는 배우가 방금 한 말을 배우 낱말 그대로 다음 테이크에 할 일 하나로 잇는다. "
                    + "코치가 새 해석·감정·이유를 보태지 않고, 앞에서 배우가 아니라고 한 해석으로 돌아가지 않는다");
        }
        return lines;
    }

    /** 배우의 말 종류. 매번 분류만 하는 AI(영상 없음)에게 묻는다. 실패하면 보통 답으로 이어간다. */
    private PracticeLoopRouter.Classified classify(CoachSessionSnapshot session, String actorText, UUID operationId) {
        var transcript = new ArrayList<DirectVideoModel.Message>();
        // 이 세션의 대화 전체를 준다. 첫 비추기부터 봐야 정정·반박·선택 설명을 가릴 수 있다(상한 24턴이라 길지 않다).
        for (var turn : session.turns()) {
            transcript.add(new DirectVideoModel.Message("ai".equals(turn.role()) ? "model" : "user", turn.text()));
        }
        transcript.add(new DirectVideoModel.Message("user", actorText));
        Instant started = Instant.now();
        String output = "";
        String error = null;
        ExternalOperationExecution.externalCall("model");
        try {
            output = model.classify(java.util.List.copyOf(transcript), DirectVideoPrompts.practiceLoopClassifier(),
                    PracticeLoopRouter.SIGNALS);
            return PracticeLoopRouter.parse(output);
        } catch (RuntimeException failure) {
            error = failure.getClass().getSimpleName();
            if (Thread.currentThread().isInterrupted()) throw failure;
            failures.report(failure, FailureKind.EXTERNAL, new FailureContext("DirectVideoCoach.classify", operationId));
            return new PracticeLoopRouter.Classified(PracticeLoopRouter.Kind.ANSWER, false, "fallback");
        } finally {
            telemetry.record(new LlmCall(LlmStep.COACH_ROUTE, session.practiceSessionId(), session.userId(), model.model(),
                    DirectVideoPrompts.practiceLoopClassifier() + "\n" + transcript, output == null ? "" : output,
                    LlmTokens.unknown(), started, Duration.between(started, Instant.now()), error,
                    LlmCall.metadata("transport", "gemini_text_routing", "route", "practice_loop_classify"))
                    .withPrompt(new LlmPrompt("coach.practice-loop.classify", DirectVideoPrompts.practiceLoopClassifier())));
        }
    }

    /**
     * 코치 AI 없이 닫을 때의 정해진 두 문장. 영상 없이 말로 한 코칭({@code talk}, SOMA-745)은 올릴 테이크가 없어
     * "새 테이크를 올리면" 대신 다음 대화를 말한다. 한국어가 아니면 영어.
     */
    static String fixedClosing(java.util.Locale language, boolean talk, boolean listen) {
        // 리딩 녹음 코칭(SOMA-791): 다음은 영상으로 이어 간다.
        boolean korean = language == null || "ko".equals(language.getLanguage());
        if (listen) return korean ? "오늘은 여기까지 해요. 그 한 줄을 영상으로 올리면 이어서 더 깊게 볼게요."
                : "That's it for today. Upload that line as a video and we'll go deeper.";
        return fixedClosing(language, talk);
    }

    static String fixedClosing(java.util.Locale language, boolean talk) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        if (talk) return korean ? "오늘은 여기까지 해요. 다음에 또 이야기해요." : "That's it for today. Let's talk again next time.";
        return korean ? "오늘은 여기까지 해요. 새 테이크를 올리면 이어서 해요."
                : "That's it for today. Upload a new take and we'll pick up from here.";
    }

    /** 얼굴 가리기: 내려받은 원본을 가린 사본으로 바꾼다. 얼굴이 없으면 원본을 그대로 돌려준다. 그 밖에 만들 수 없으면 던진다(원본으로 돌아가지 않는다). */
    private Path masked(Path original) {
        boolean keepOriginal = false;
        try {
            if (!faceMosaic.available()) throw new IllegalStateException("face mosaic is unavailable");
            return faceMosaic.render(original);
        } catch (FaceMosaicRenderer.NoFaceFound none) {
            // 얼굴이 한 번도 안 잡히면 가릴 얼굴이 없는 영상으로 보고 원본을 그대로 쓴다(10/23 결정).
            keepOriginal = true;
            return original;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("face mosaic interrupted", interrupted);
        } catch (RuntimeException failure) {
            throw failure;
        } catch (Exception failure) {
            throw new IllegalStateException("face mosaic failed", failure);
        } finally {
            try {
                if (!keepOriginal) Files.deleteIfExists(original);
            } catch (java.io.IOException ignored) {
                // 남은 임시 파일은 기동마다 임시 폴더 정리에 맡긴다.
            }
        }
    }

    static final String PRO_MEMORY = "pro_memory";

    /**
     * Pro 지난 연습 기억 칸(SOMA-900). 첫 응답에서 한 번만 정해 상태에 남기고, 둘째 응답부터는 상태의 것을 그대로 쓴다 —
     * 대화 도중 구독이 바뀌거나 새 노트가 생겨도 같은 대화의 코치가 흔들리지 않는다. 배포 전에 시작한 대화는 칸이 없다.
     * 읽기에 실패하면 칸 없이 간다(코칭은 이어 간다).
     */
    private String proMemoryBlock(CoachSessionSnapshot session, ObjectNode state) {
        JsonNode stored = state.path(PRO_MEMORY);
        if (stored.isObject()) return stored.path("block").asText("");
        if (!session.turns().isEmpty()) return "";
        ObjectNode memory = state.putObject(PRO_MEMORY);
        boolean pro = CoachPro.safe(coachPro, session.userId());
        memory.put("pro", pro);
        String block = "";
        if (pro) {
            try {
                var pasts = proMemory.recent(session.userId(), session.practiceSessionId(), CoachProMemory.LIMIT);
                block = CoachProMemory.block(pasts);
                memory.put("pasts", pasts.size());
            } catch (RuntimeException failure) {
                failures.report(failure, FailureKind.UNEXPECTED,
                        new FailureContext("DirectVideoCoach.proMemory", session.practiceSessionId()));
            }
        }
        memory.put("block", block);
        return block;
    }

    /** 저장된 상태를 복사해 다음 판으로 올린다. 저장 판이 어긋나면 실패한다. */
    /** 1층 배정. 저장된 값이 있으면 그대로, 없으면 연습 id 로 정한다. */
    private String layerOneArm(CoachSessionSnapshot session) {
        JsonNode stored = session.coachingState() == null ? null : session.coachingState().path(LAYER1).path("arm");
        if (stored != null && stored.isTextual() && !stored.asText().isEmpty()) return stored.asText();
        return layerOne.arm(session.practiceSessionId(), session.userId());
    }

    /** 1층 칸. 상태에 있으면 그것, 없으면 끝난 결과를 가져와 상태에 남긴다. 배정·기다림·사용 여부도 상태에 적는다. */
    private String layerOneBlock(CoachSessionSnapshot session, ObjectNode state, String arm) {
        ObjectNode layer = state.path(LAYER1).isObject() ? (ObjectNode) state.path(LAYER1) : state.putObject(LAYER1);
        layer.put("arm", arm);
        if (!CoachLayerOne.on(arm)) return "";
        String block = layer.path("block").asText("");
        if (block.isEmpty()) {
            try {
                block = layerOne.ready(session.practiceSessionId());
            } catch (RuntimeException failure) {
                block = "";
            }
            if (!block.isEmpty()) {
                layer.put("block", block);
                layer.put("from_turn", session.turns().size());
            } else {
                layer.put("pending_turns", layer.path("pending_turns").asInt(0) + 1);
            }
        }
        return block.isEmpty() ? "" : block.strip() + "\n\n";
    }

    private static ObjectNode nextState(CoachSessionSnapshot session) {
        ObjectNode state = session.coachingState() == null ? CoachingStateReducer.empty()
                : ((ObjectNode) session.coachingState()).deepCopy();
        CoachingStateReducer.require(state.path("revision").asLong() == session.stateRevision(), "stored revision mismatch");
        state.put("revision", session.stateRevision() + 1);
        return state;
    }

    /**
     * 미리 준비가 늦을 때 함께 도는 준비(10/27): 원본을 받아 소리 검사·올리기·처리 대기를 한다. 소리가 없거나 빈 영상이면
     * 올리지 않고 검사 결과만 돌려준다 — 첫 질문이 그 결과로 안내한다. 미리 준비와 같은 일이다.
     */
    private CoachVideoCache.Prepared prepareDirect(CoachVideoSource.Video source, String mimeType, String label) {
        Path file = null;
        DirectVideoModel.Video sent = null;
        try {
            // 주인만 읽고 쓰게 만든다 — 공용 임시 폴더에 다른 사용자가 끼어들 수 없게.
            file = Files.createTempFile("coach-hedge-", ".video", java.nio.file.attribute.PosixFilePermissions.asFileAttribute(
                    java.nio.file.attribute.PosixFilePermissions.fromString("rw-------")));
            var metadata = storage.downloadToPath(source.objectKey(), file);
            if (source.etag() != null && !source.etag().isBlank() && metadata != null && metadata.etag() != null
                    && !source.etag().replace("\"", "").equals(metadata.etag().replace("\"", ""))) {
                throw new IllegalStateException("original video changed after upload");
            }
            DirectVideoModel.InputInspection inspection = model.inspect(file);
            if (inspection != null && (inspection.unusableAudio() || inspection.emptyInput())) {
                return new CoachVideoCache.Prepared(inspection, null);
            }
            sent = label != null ? model.upload(file, mimeType, inspection, label)
                    : inspection == null || inspection.hasAudioTrack() == null
                    ? model.upload(file, mimeType) : model.upload(file, mimeType, inspection);
            long deadline = System.nanoTime() + Duration.ofSeconds(180).toNanos();
            while (!model.ready(sent)) {
                if (System.nanoTime() >= deadline) throw new IllegalStateException("video processing timed out");
                Thread.sleep(500);
            }
            return new CoachVideoCache.Prepared(inspection, sent);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            deleteQuietly(sent);
            return null;
        } catch (java.io.IOException failure) {
            throw new java.io.UncheckedIOException(failure);
        } catch (RuntimeException failure) {
            deleteQuietly(sent);
            throw failure;
        } finally {
            if (file != null) {
                try {
                    Files.deleteIfExists(file);
                } catch (java.io.IOException ignored) {
                    // 임시 파일 정리 실패는 코칭에 영향이 없다.
                }
            }
        }
    }

    private void deleteQuietly(DirectVideoModel.Video video) {
        if (video == null) return;
        try {
            model.delete(video);
        } catch (RuntimeException ignored) {
            // 못 지운 파일은 Gemini 가 48시간 뒤 지우고, 이름표가 있으면 고아 청소가 먼저 지운다.
        }
    }
}
