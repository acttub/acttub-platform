package com.acttub.actingapi.feature.practice.app;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeRepository.Cancelled;
import com.acttub.actingapi.feature.practice.app.PracticeRepository.NewPractice;
import com.acttub.actingapi.feature.practice.app.PracticeRepository.Quota;
import com.acttub.actingapi.feature.practice.app.PracticeRepository.Started;
import com.acttub.actingapi.feature.practice.app.PracticeViews.GroupView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.PracticeView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.StatusView;
import com.acttub.actingapi.feature.practice.domain.PracticeRules;
import com.acttub.actingapi.platform.schema.ExperienceVersion;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.Hashing;

/**
 * 회차·묶음의 규칙 (practice.start, practice.resume, practice.analyze).
 *
 * <p><b>회차 하나와 분석 작업 하나를 한 트랜잭션으로 만든다.</b> 도중에 실패하면 둘 다 없다. 첫 회차는 새 묶음
 * ({@code root_id = 자기}, {@code ordinal = 1})이고, 이어하기는 같은 묶음의 다음 차수다 — 묶음에 닫히지 않은
 * 회차가 있으면 만들지 않고 409 {@code practice_in_progress} 다(본문은 코드 하나, 회차 id 는 묶음 조회에서 얻는다).
 *
 * <p>Scene Context 는 셋 모두 선택이고 시작 뒤 바꾸지 않는다. 막힘을 고르지 않으면 "그 외/그 외"다. 이론 선택은
 * 0.1.0 에 없다. 코칭 갈래({@code experience_version})는 서버 플래그와 계약 헤더가 맞으면 신형이다(적은 것과 무관).
 */
public class PracticeService {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private final PracticeRepository practices;
    /** 아직 옮기지 않은 옛 연습을 같은 모양으로 읽는 자리 (specs/practice ②). */
    private final LegacyPracticeReader legacy;
    private final PracticePosters posters;
    private final boolean threeLayersEnabled;
    private final boolean guestDailyAnalysisLimitEnabled;
    private final CoachingPlan plan;
    private final Clock clock;

    public PracticeService(
            PracticeRepository practices,
            LegacyPracticeReader legacy,
            PracticePosters posters,
            boolean threeLayersEnabled,
            boolean guestDailyAnalysisLimitEnabled,
            Clock clock) {
        this(practices, legacy, posters, threeLayersEnabled, guestDailyAnalysisLimitEnabled, CoachingPlan.UNLIMITED, clock);
    }

    public PracticeService(
            PracticeRepository practices,
            LegacyPracticeReader legacy,
            PracticePosters posters,
            boolean threeLayersEnabled,
            boolean guestDailyAnalysisLimitEnabled,
            CoachingPlan plan,
            Clock clock) {
        this.plan = plan;
        this.practices = practices;
        this.legacy = legacy;
        this.posters = posters;
        this.threeLayersEnabled = threeLayersEnabled;
        this.guestDailyAnalysisLimitEnabled = guestDailyAnalysisLimitEnabled;
        this.clock = clock;
    }

    /**
     * 새 묶음의 첫 회차. 영상은 보관함에 확정돼 있어야 한다. 제목을 적었으면 묶음 제목(첫 행)이 된다 — 묶음 속성
     * 수정과 같은 자리다.
     */
    public PracticeView start(UUID userId, boolean guest, String contractHeader, Draft draft) {
        boolean withVideo = draft.videoId() != null;
        if (!PracticeRules.videoMatchesPurpose(withVideo, PracticeRules.sessionPurpose(draft.sessionPurpose()))) {
            // 요청 검증(PracticeCreateRequest)이 먼저 422 배열로 거절한다. 여기 닿으면 부르는 쪽의 잘못이다.
            throw new IllegalArgumentException("a practice without a video needs a talk purpose");
        }
        if (!withVideo) {
            // 영상 없이 말로 하는 코칭(SOMA-745): 분석할 영상이 없어 분석 작업 없이 바로 대화 단계로 연다. 분석 한도도 쓰지 않는다.
            // 말로 하는 코치는 새 코치(three_layers_v1)에만 있다 — 계약 헤더와 상관없이 새 코치로 연다.
            // 가릴 영상이 없어 얼굴 가리기는 무시한다.
            Quota free = freeQuota(userId);
            return answer(practices.startWithoutVideo(userId, newPractice(withFaceMosaic(draft, null), contractHeader, true), free,
                    clock.instant()), free);
        }
        // 얼굴 가리기는 켰을 때만 남긴다 — 끈 것과 뺀 것은 같고, 지문도 이 변경 전과 같다.
        Quota quota = coachingQuota(userId, guest);
        return answer(practices.start(userId, newPractice(withFaceMosaic(draft, Boolean.TRUE.equals(draft.faceMosaic()) ? true : null),
                contractHeader), quota, clock.instant()), quota);
    }

    /**
     * 같은 묶음의 다음 회차. 영상을 보내지 않으면 이어받을 회차의 영상을 그대로 쓴다 — 그 영상이 파기됐으면
     * 422 {@code video_not_ready} 이고 새 영상으로는 된다.
     */
    public PracticeView continueGroup(UUID userId, boolean guest, String contractHeader, UUID from, Draft draft) {
        // 이어하기는 늘 영상으로 한다. 영상 없는 묶음을 이으려면 새 영상을 보낸다(없으면 422 video_not_ready).
        Quota quota = coachingQuota(userId, guest);
        return answer(practices.continueGroup(
                userId, from, draft.videoId(), newPractice(draft, contractHeader), quota, clock.instant()), quota);
    }

    /**
     * 실패한 회차의 분석을 다시 건다. 새 작업과 함께 {@code analyzing} 으로 돌아가고, 묶음에 다른 진행 중 회차가
     * 있으면 409 다. 게스트의 하루 한도를 한 번 쓴다.
     */
    public PracticeView retryAnalysis(UUID userId, boolean guest, UUID practiceId, UUID requestId) {
        return answer(practices.retryAnalysis(
                userId, practiceId, requestId, fingerprint("analyze_retry|" + practiceId), quota(guest), clock.instant()));
    }

    /**
     * 회차 하나. <b>새 표를 먼저 보고 없으면 옛 표를 읽는다</b>(specs/practice ②) — 화면은 어느 표에서 왔는지
     * 알 필요가 없다. 없는 것과 남의 것은 두 표 모두에서 같은 404 다.
     */
    public PracticeView find(UUID userId, UUID practiceId) {
        PracticeView view = practices.find(userId, practiceId);
        if (view == null) {
            view = legacy.find(userId, practiceId);
            if (view == null) {
                throw notFound();
            }
            return poster(view);
        }
        // 옮긴 회차에도 옛 대화가 남아 있을 수 있다 — 전환은 최신 하나만 새 표로 옮기고 나머지는 옛 표에
        // 그대로 둔다(practice.coach "옛 자료의 복수 대화").
        List<PracticeViews.PreviousConversation> previous =
                legacy.previousConversations(userId, practiceId);
        return poster(previous.isEmpty() ? view : view.withPrevious(previous));
    }

    public StatusView status(UUID userId, UUID practiceId) {
        StatusView view = practices.status(userId, practiceId);
        if (view == null) {
            PracticeView fallback = legacy.find(userId, practiceId);
            view = fallback == null
                    ? null
                    : new StatusView(
                            fallback.stage(), fallback.closeReason(), fallback.analysisStatus(), fallback.job());
        }
        if (view == null) {
            throw notFound();
        }
        return view;
    }

    public PracticeViews.AnalysisView analysis(UUID userId, UUID practiceId) {
        find(userId, practiceId);
        PracticeViews.AnalysisView analysis = practices.analysis(userId, practiceId);
        if (analysis == null) {
            throw new ApiException(404, "analysis_not_found");
        }
        return analysis;
    }

    /** 옮긴 묶음과 아직 옮기지 않은 묶음을 함께 낸다 — 배우에게는 한 목록이다. */
    public List<GroupView> groups(UUID userId, String filter) {
        List<GroupView> groups = new java.util.ArrayList<>(practices.groups(userId, filter, clock.instant()));
        groups.addAll(legacy.groups(userId, filter));
        return groups.stream().map(this::posters).toList();
    }

    /** "그만두기". 화면 이탈은 취소가 아니다 — 그쪽은 조회만 멈춘다. */
    public StatusView cancel(UUID userId, UUID practiceId) {
        Cancelled cancelled = practices.cancel(userId, practiceId, clock.instant());
        return switch (cancelled.outcome()) {
            case CANCELLED -> cancelled.status();
            case ALREADY_DONE -> throw new ApiException(409, "analysis_already_finished");
            case NOT_FOUND -> throw notFound();
        };
    }

    public GroupView updateGroup(UUID userId, UUID rootId, Boolean favorite, Boolean hidden, String title) {
        GroupView group = practices.updateGroup(userId, rootId, favorite, hidden, title, clock.instant());
        if (group == null) {
            throw notFound();
        }
        return posters(group);
    }

    /**
     * 시작·이어하기 요청의 값. 한도를 넘는 길이는 부르는 쪽이 값 오류(422 배열)로 거절한다.
     *
     * @param title 묶음 제목. 시작만 받는다 — 이어하기는 {@code null} 이다
     */
    public record Draft(
            UUID requestId,
            UUID videoId,
            String situation,
            String characterContext,
            String goal,
            String blockageKind,
            String subBranch,
            String blockageNote,
            String title,
            String sessionPurpose,
            // 얼굴 가리기(practice.start). 시작은 null·false 가 끔이고, 이어하기는 null 이면 이어받을 회차의 값이다.
            Boolean faceMosaic) {

        /** 세션 목적이 없던 때의 모양. 이어하기와 옛 호출부가 쓴다. */
        public Draft(UUID requestId, UUID videoId, String situation, String characterContext, String goal,
                String blockageKind, String subBranch, String blockageNote, String title) {
            this(requestId, videoId, situation, characterContext, goal, blockageKind, subBranch, blockageNote, title, null);
        }

        /** 얼굴 가리기가 없던 때의 모양. */
        public Draft(UUID requestId, UUID videoId, String situation, String characterContext, String goal,
                String blockageKind, String subBranch, String blockageNote, String title, String sessionPurpose) {
            this(requestId, videoId, situation, characterContext, goal, blockageKind, subBranch, blockageNote, title,
                    sessionPurpose, null);
        }
    }

    private NewPractice newPractice(Draft draft, String contractHeader) {
        return newPractice(draft, contractHeader, false);
    }

    private static Draft withFaceMosaic(Draft draft, Boolean faceMosaic) {
        return new Draft(draft.requestId(), draft.videoId(), draft.situation(), draft.characterContext(), draft.goal(),
                draft.blockageKind(), draft.subBranch(), draft.blockageNote(), draft.title(), draft.sessionPurpose(),
                faceMosaic);
    }

    private NewPractice newPractice(Draft draft, String contractHeader, boolean forceThreeLayers) {
        String situation = PracticeRules.scene(draft.situation());
        String characterContext = PracticeRules.scene(draft.characterContext());
        String goal = PracticeRules.scene(draft.goal());
        String blockageKind = PracticeRules.blockage(draft.blockageKind());
        String subBranch = PracticeRules.blockage(draft.subBranch());
        String blockageNote = PracticeRules.note(draft.blockageNote());
        String title = PracticeRules.title(draft.title());
        String sessionPurpose = PracticeRules.sessionPurpose(draft.sessionPurpose());
        String experienceVersion = forceThreeLayers || PracticeRules.threeLayers(threeLayersEnabled, contractHeader)
                ? ExperienceVersion.THREE_LAYERS_V1.dbValue()
                : ExperienceVersion.LEGACY.dbValue();
        // 제목은 있을 때만 지문에 넣는다 — 제목 없는 요청의 지문이 이 변경 전과 같아야 배포를 걸친 재전송이 산다.
        String payload = String.join("|", "practice_start",
                String.valueOf(draft.videoId()), situation, characterContext, goal,
                blockageKind, subBranch, String.valueOf(blockageNote));
        // 세션 목적도 있을 때만 넣는다(SOMA-719) — 목적 없는 요청의 지문은 이 변경 전과 같다.
        String withTitle = title == null ? payload : payload + "|title|" + title;
        String withPurpose = sessionPurpose == null ? withTitle : withTitle + "|purpose|" + sessionPurpose;
        // 얼굴 가리기도 값이 있을 때만 넣는다 — 값 없는 요청의 지문은 이 변경 전과 같다.
        return new NewPractice(
                draft.requestId(),
                fingerprint(draft.faceMosaic() == null ? withPurpose : withPurpose + "|face_mosaic|" + draft.faceMosaic()),
                draft.videoId(),
                experienceVersion,
                situation,
                characterContext,
                goal,
                blockageKind,
                subBranch,
                blockageNote,
                title,
                sessionPurpose,
                draft.faceMosaic());
    }

    /**
     * 새 회차의 하루 한도. 무료 코칭 한도(SOMA-818)가 걸리는 사람은 그것만 본다 — 하루 1회차가 게스트의 분석 3회보다 좁다.
     * 그 밖에는 게스트의 분석 한도다.
     */
    private Quota coachingQuota(UUID userId, boolean guest) {
        Quota free = freeQuota(userId);
        return free != null ? free : quota(guest);
    }

    private Quota freeQuota(UUID userId) {
        if (!plan.freeLimited(userId)) {
            return null;
        }
        Instant midnight = LocalDate.now(clock.withZone(SEOUL)).atStartOfDay(SEOUL).toInstant();
        return new Quota(PracticeRules.FREE_DAILY_COACHING_SESSIONS, midnight, Quota.Kind.SESSIONS);
    }

    /** 게스트만 하루 한도가 있다. 하루는 한국 시간 자정에 끊는다. */
    private Quota quota(boolean guest) {
        if (!guest || !guestDailyAnalysisLimitEnabled) {
            return null;
        }
        Instant midnight = LocalDate.now(clock.withZone(SEOUL)).atStartOfDay(SEOUL).toInstant();
        return new Quota(PracticeRules.GUEST_DAILY_ANALYSES, midnight);
    }

    /**
     * 회차 영상의 포스터 주소 — 보관함과 같은 서명 GET 이다. 키가 없으면(아직 안 만들었거나 파일을 파기했으면)
     * {@code null} 이다. 서명은 서버 안의 계산이라 바깥 호출이 없다.
     */
    private PracticeView poster(PracticeView view) {
        return view.posterKey() == null ? view : view.withPoster(posters.url(view.posterKey()));
    }

    private GroupView posters(GroupView group) {
        return group.withPractices(group.practices().stream().map(this::poster).toList());
    }

    private PracticeView answer(Started started) {
        return answer(started, null);
    }

    private PracticeView answer(Started started, Quota quota) {
        return switch (started.outcome()) {
            case CREATED, REPLAYED -> poster(started.practice());
            case VIDEO_NOT_READY -> throw new ApiException(422, "video_not_ready");
            case IN_PROGRESS -> throw new ApiException(409, "practice_in_progress");
            case QUOTA -> throw quota != null && quota.kind() == Quota.Kind.SESSIONS
                    ? new ApiException(429, "free_daily_coaching_limit")
                    : new ApiException(429, "guest_daily_analysis_limit");
            case FINGERPRINT_MISMATCH -> throw new ApiException(422, "request_fingerprint_mismatch");
            case NOT_FAILED -> throw new ApiException(409, "analysis_not_failed");
            case NOT_FOUND -> throw notFound();
        };
    }

    private static ApiException notFound() {
        return new ApiException(404, "practice_not_found");
    }

    static String fingerprint(String payload) {
        return Hashing.sha256Hex(payload);
    }
}
