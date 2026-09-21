package com.acttub.actingapi.feature.practice.app;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HexFormat;
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
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 회차·묶음의 규칙 (practice.start, practice.resume, practice.analyze).
 *
 * <p><b>회차 하나와 분석 작업 하나를 한 트랜잭션으로 만든다.</b> 도중에 실패하면 둘 다 없다. 첫 회차는 새 묶음
 * ({@code root_id = 자기}, {@code ordinal = 1})이고, 이어하기는 같은 묶음의 다음 차수다 — 묶음에 닫히지 않은
 * 회차가 있으면 만들지 않고 409 {@code practice_in_progress} 다(본문은 코드 하나, 회차 id 는 묶음 조회에서 얻는다).
 *
 * <p>Scene Context 는 셋 모두 선택이고 시작 뒤 바꾸지 않는다. 막힘을 고르지 않으면 "그 외/그 외"다. 이론 선택은
 * 1.0.0 에 없다. 코칭 갈래({@code experience_version})는 서버 플래그·계약 헤더·무입력 조건이 모두 맞을 때만 신형이다.
 */
public class PracticeService {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private final PracticeRepository practices;
    /** 아직 옮기지 않은 옛 연습을 같은 모양으로 읽는 자리 (02-practice ②). */
    private final LegacyPracticeReader legacy;
    private final boolean threeLayersEnabled;
    private final Clock clock;

    public PracticeService(
            PracticeRepository practices,
            LegacyPracticeReader legacy,
            boolean threeLayersEnabled,
            Clock clock) {
        this.practices = practices;
        this.legacy = legacy;
        this.threeLayersEnabled = threeLayersEnabled;
        this.clock = clock;
    }

    /** 새 묶음의 첫 회차. 영상은 보관함에 확정돼 있어야 한다. */
    public PracticeView start(UUID userId, boolean guest, String contractHeader, Draft draft) {
        return answer(practices.start(userId, newPractice(draft, contractHeader), quota(guest), clock.instant()));
    }

    /**
     * 같은 묶음의 다음 회차. 영상을 보내지 않으면 이어받을 회차의 영상을 그대로 쓴다 — 그 영상이 파기됐으면
     * 422 {@code video_not_ready} 이고 새 영상으로는 된다.
     */
    public PracticeView continueGroup(UUID userId, boolean guest, String contractHeader, UUID from, Draft draft) {
        return answer(practices.continueGroup(
                userId, from, draft.videoId(), newPractice(draft, contractHeader), quota(guest), clock.instant()));
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
     * 회차 하나. <b>새 표를 먼저 보고 없으면 옛 표를 읽는다</b>(02-practice ②) — 화면은 어느 표에서 왔는지
     * 알 필요가 없다. 없는 것과 남의 것은 두 표 모두에서 같은 404 다.
     */
    public PracticeView find(UUID userId, UUID practiceId) {
        PracticeView view = practices.find(userId, practiceId);
        if (view == null) {
            view = legacy.find(userId, practiceId);
            if (view == null) {
                throw notFound();
            }
            return view;
        }
        // 옮긴 회차에도 옛 대화가 남아 있을 수 있다 — 전환은 최신 하나만 새 표로 옮기고 나머지는 옛 표에
        // 그대로 둔다(practice.coach "옛 자료의 복수 대화").
        List<PracticeViews.PreviousConversation> previous =
                legacy.previousConversations(userId, practiceId);
        return previous.isEmpty() ? view : withPrevious(view, previous);
    }

    private static PracticeView withPrevious(
            PracticeView view, List<PracticeViews.PreviousConversation> previous) {
        return new PracticeView(
                view.id(), view.rootId(), view.ordinal(), view.videoId(), view.stage(), view.closeReason(),
                view.experienceVersion(), view.situation(), view.characterContext(), view.goal(),
                view.blockageKind(), view.subBranch(), view.blockageNote(), view.createdAt(),
                view.analysisStatus(), view.conversationId(), view.conversationStatus(),
                view.conversationCount(), view.noteId(), view.noteTitle(), view.noteKind(), view.job(),
                previous);
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

    /** 옮긴 묶음과 아직 옮기지 않은 묶음을 함께 낸다 — 배우에게는 한 목록이다. */
    public List<GroupView> groups(UUID userId, String filter) {
        List<GroupView> groups = new java.util.ArrayList<>(practices.groups(userId, filter, clock.instant()));
        groups.addAll(legacy.groups(userId, filter));
        return List.copyOf(groups);
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
        return group;
    }

    /** 시작·이어하기 요청의 값. 한도를 넘는 길이는 부르는 쪽이 값 오류(422 배열)로 거절한다. */
    public record Draft(
            UUID requestId,
            UUID videoId,
            String situation,
            String characterContext,
            String goal,
            String blockageKind,
            String subBranch,
            String blockageNote) {
    }

    private NewPractice newPractice(Draft draft, String contractHeader) {
        String situation = PracticeRules.scene(draft.situation());
        String characterContext = PracticeRules.scene(draft.characterContext());
        String goal = PracticeRules.scene(draft.goal());
        String blockageKind = PracticeRules.blockage(draft.blockageKind());
        String subBranch = PracticeRules.blockage(draft.subBranch());
        String blockageNote = PracticeRules.note(draft.blockageNote());
        String experienceVersion = PracticeRules.threeLayers(
                threeLayersEnabled, contractHeader, situation, characterContext, goal, blockageKind, blockageNote)
                ? "three_layers_v1"
                : "legacy";
        return new NewPractice(
                draft.requestId(),
                fingerprint(String.join("|", "practice_start",
                        String.valueOf(draft.videoId()), situation, characterContext, goal,
                        blockageKind, subBranch, String.valueOf(blockageNote))),
                draft.videoId(),
                experienceVersion,
                situation,
                characterContext,
                goal,
                blockageKind,
                subBranch,
                blockageNote);
    }

    /** 게스트만 하루 한도가 있다. 하루는 한국 시간 자정에 끊는다. */
    private Quota quota(boolean guest) {
        if (!guest) {
            return null;
        }
        Instant midnight = LocalDate.now(clock.withZone(SEOUL)).atStartOfDay(SEOUL).toInstant();
        return new Quota(PracticeRules.GUEST_DAILY_ANALYSES, midnight);
    }

    private static PracticeView answer(Started started) {
        return switch (started.outcome()) {
            case CREATED, REPLAYED -> started.practice();
            case VIDEO_NOT_READY -> throw new ApiException(422, "video_not_ready");
            case IN_PROGRESS -> throw new ApiException(409, "practice_in_progress");
            case QUOTA -> throw new ApiException(429, "guest_daily_analysis_limit");
            case FINGERPRINT_MISMATCH -> throw new ApiException(422, "request_fingerprint_mismatch");
            case NOT_FAILED -> throw new ApiException(409, "analysis_not_failed");
            case NOT_FOUND -> throw notFound();
        };
    }

    private static ApiException notFound() {
        return new ApiException(404, "practice_not_found");
    }

    static String fingerprint(String payload) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
