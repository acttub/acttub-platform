package com.acttub.actingapi.feature.invite.app;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.app.ConversationClosedListener;
import com.acttub.actingapi.feature.invite.app.InviteRepository.Practice;
import com.acttub.actingapi.feature.invite.app.InviteRepository.Reward;
import com.acttub.actingapi.feature.invite.app.InviteRepository.State;
import com.acttub.actingapi.feature.reading.app.ReadingCompletionListener;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 친구 초대의 규칙(SOMA-865, account.invite). 친구가 내 코드로 가입하고 첫 연습을 끝내면 둘 다 Pro 1개월을 받는다.
 *
 * <ul>
 *   <li>코드: 회원마다 하나, 헷갈리는 0·O·1·I 를 뺀 6자리. 처음 내 초대 상태를 열 때 만든다.</li>
 *   <li>넣기: 본인 코드 불가, 회원당 한 번, 가입 뒤 {@link InviteSettings#redeemWindow()} 안, 게스트·탈퇴 계정 불가.</li>
 *   <li>지급: 코드를 넣은 뒤 끝낸 첫 센 연습(리딩 완료·노트가 남은 코칭)에서 한 번. 초대한 사람은 한국 시간 한 달에
 *       {@link InviteSettings#inviterMonthlyCap()} 번까지 받는다. 기간은 {@code billing_pro_grants} 줄이라 결제 구독은 건드리지 않는다.</li>
 * </ul>
 *
 * <p>스위치({@link InviteSettings#enabled()})가 꺼져 있으면 경로는 404 {@code invite_unavailable} 이고 연습 완료 알림은 DB 를
 * 읽지 않고 돌아간다.
 */
public class InviteService implements ReadingCompletionListener, ConversationClosedListener {
    private static final Logger LOG = LoggerFactory.getLogger(InviteService.class);
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    /** 0·O·1·I 를 뺀 글자 32개. */
    static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    static final int CODE_LENGTH = 6;
    private static final Pattern CODE = Pattern.compile("[" + ALPHABET + "]{" + CODE_LENGTH + "}");
    private static final int ATTACH_ATTEMPTS = 8;

    private final InviteSettings settings;
    private final InviteRepository repository;
    private final InviteRewardListener rewards;
    private final FailureReporter failures;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public InviteService(InviteSettings settings, InviteRepository repository, InviteRewardListener rewards,
            FailureReporter failures, Clock clock) {
        this.settings = settings;
        this.repository = repository;
        this.rewards = rewards;
        this.failures = failures;
        this.clock = clock;
    }

    // ── 경로 ───────────────────────────────────────────────────────

    /** 내 초대 상태. 코드가 아직 없으면 만든다. */
    public View view(AuthenticatedUser user) {
        requireMember(user);
        return viewOf(user.id(), ensureCode(user.id()));
    }

    /**
     * 받은 초대 코드를 넣는다. 대소문자·띄어쓰기·하이픈은 가린다.
     *
     * @throws ApiException 404 {@code invite_unavailable}(스위치 꺼짐), 403 {@code invite_member_required}(게스트),
     *     404 {@code invite_code_not_found}(모양이 틀리거나 없는·탈퇴한 사람의 코드), 409 {@code own_invite_code},
     *     409 {@code invite_already_redeemed}, 409 {@code invite_window_closed}(가입 뒤 기간이 지남),
     *     403 {@code account_deactivated}(요청 사이에 탈퇴)
     */
    public View redeem(AuthenticatedUser user, String rawCode) {
        requireMember(user);
        String code = normalize(rawCode);
        InviteRepository.RedeemOutcome outcome = code == null
                ? InviteRepository.RedeemOutcome.CODE_NOT_FOUND
                : repository.redeem(user.id(), code, clock.instant(), settings.redeemWindow());
        switch (outcome) {
            case REDEEMED -> { }
            case ALREADY_REDEEMED -> throw new ApiException(409, "invite_already_redeemed");
            case WINDOW_CLOSED -> throw new ApiException(409, "invite_window_closed");
            case CODE_NOT_FOUND -> throw new ApiException(404, "invite_code_not_found");
            case OWN_CODE -> throw new ApiException(409, "own_invite_code");
            case ACCOUNT_INACTIVE -> throw new ApiException(403, "account_deactivated");
        }
        return viewOf(user.id(), ensureCode(user.id()));
    }

    // ── 첫 연습 ────────────────────────────────────────────────────

    @Override
    public void onReadingCompleted(UUID userId, UUID sessionId) {
        practiced(userId, Practice.READING, sessionId);
    }

    @Override
    public void onConversationClosed(UUID userId, UUID practiceId) {
        practiced(userId, Practice.COACHING, practiceId);
    }

    /**
     * 연습 하나가 끝났다 — 지급할 초대 기록이 있으면 지급하고 둘에게 알린다. <b>어떤 실패도 밖으로 내보내지 않는다</b>: 연습 저장은
     * 이미 끝났고 초대 보상 때문에 그 응답이 실패하면 안 된다. 지급은 한 트랜잭션이라 실패하면 아무것도 남지 않고 다음 연습에서
     * 다시 시도된다.
     */
    private void practiced(UUID userId, Practice practice, UUID practiceId) {
        if (!settings.enabled() || userId == null || practiceId == null) {
            return;
        }
        Optional<Reward> reward;
        try {
            reward = repository.rewardIfCounted(userId, practice, practiceId, clock.instant(), monthStart(),
                    settings.inviterMonthlyCap());
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("InviteService.practiced"));
            return;
        }
        reward.ifPresent(granted -> {
            // 계측: 보상 지급(서버 기록). 사람을 알아볼 값은 싣지 않는다.
            LOG.info("invite_reward_granted practice={} inviter_rewarded={}", practice.name().toLowerCase(Locale.ROOT),
                    granted.inviterId() != null);
            notifyRewarded(granted.inviteeId(), false);
            if (granted.inviterId() != null) {
                notifyRewarded(granted.inviterId(), true);
            }
        });
    }

    private void notifyRewarded(UUID userId, boolean asInviter) {
        if (rewards == null) {
            return;
        }
        try {
            rewards.onInviteRewarded(userId, asInviter);
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("InviteService.notifyRewarded"));
        }
    }

    // ── 내부 ───────────────────────────────────────────────────────

    private void requireMember(AuthenticatedUser user) {
        if (!settings.enabled()) {
            throw new ApiException(404, "invite_unavailable");
        }
        if (user.guest()) {
            throw new ApiException(403, "invite_member_required");
        }
    }

    private View viewOf(UUID userId, String code) {
        State state = repository.state(userId);
        Instant now = clock.instant();
        Instant redeemUntil = state == null || state.signedUpAt() == null ? null : state.signedUpAt().plus(settings.redeemWindow());
        boolean redeemed = state != null && state.redeemed();
        boolean canRedeem = !redeemed && redeemUntil != null && now.isBefore(redeemUntil);
        return new View(code, canRedeem, canRedeem ? redeemUntil : null, redeemed, state != null && state.rewarded(),
                state == null ? 0 : state.rewardCount());
    }

    private String ensureCode(UUID userId) {
        Optional<String> existing = repository.findCode(userId);
        if (existing.isPresent()) {
            return existing.get();
        }
        for (int attempt = 0; attempt < ATTACH_ATTEMPTS; attempt++) {
            Optional<String> attached = repository.attachCode(userId, newCode());
            if (attached.isPresent()) {
                return attached.get();
            }
        }
        // 32^6(약 10억) 칸에서 여덟 번 연속 겹칠 일은 사실상 없다 — 생기면 코드 공간이 찬 것이라 사람이 봐야 한다.
        throw new IllegalStateException("invite code space exhausted");
    }

    String newCode() {
        StringBuilder code = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return code.toString();
    }

    /** 넣은 글을 코드 모양으로 맞춘다. 모양이 틀리면 null. */
    static String normalize(String raw) {
        if (raw == null) {
            return null;
        }
        String code = raw.replaceAll("[\\s-]", "").toUpperCase(Locale.ROOT);
        return CODE.matcher(code).matches() ? code : null;
    }

    /** 한국 시간 이번 달 1일 0시. 초대한 사람의 월 상한을 세는 시작점이다. */
    Instant monthStart() {
        return clock.instant().atZone(SEOUL).withDayOfMonth(1).truncatedTo(ChronoUnit.DAYS).toInstant();
    }

    /**
     * 내 초대 상태.
     *
     * @param canRedeem 지금 코드를 넣을 수 있음(아직 안 넣었고 가입 뒤 기간 안)
     * @param redeemUntil 넣을 수 있는 마지막 시각. 넣을 수 없으면 null
     * @param rewardCount 친구 초대로 받은 Pro 기간 수(앱이 늘어난 것을 보고 지급 이벤트를 남긴다)
     */
    public record View(String code, boolean canRedeem, Instant redeemUntil, boolean redeemed, boolean rewarded,
            int rewardCount) {
    }
}
