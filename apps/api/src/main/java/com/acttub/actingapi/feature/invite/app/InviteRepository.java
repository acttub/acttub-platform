package com.acttub.actingapi.feature.invite.app;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 친구 초대의 영속(SOMA-865, 표 {@code invite_codes}·{@code invite_redemptions}, 지급은 {@code billing_pro_grants}). */
public interface InviteRepository {

    /** 이 사람의 초대 코드. 아직 없으면 비어 있다. */
    Optional<String> findCode(UUID userId);

    /**
     * 이 사람에게 코드를 하나 붙인다. 이미 붙어 있으면 그 코드를 돌려준다(동시에 두 번 불러도 하나만 남는다). 다른 사람이 이미
     * 쓰는 코드라 붙이지 못했으면 비어 있다 — 부르는 쪽이 새 코드로 다시 시도한다.
     */
    Optional<String> attachCode(UUID userId, String code);

    /** 내 초대 상태. 계정 행이 없으면 null. */
    State state(UUID userId);

    /**
     * 코드를 넣는다. 넣은 사람의 계정 행을 잡아 줄을 세우고, 규칙을 차례로 본다: 이미 넣었음 → 가입 뒤 {@code window} 가 지남 →
     * 없는(또는 탈퇴·게스트의) 코드 → 내 코드. 모두 통과하면 한 줄을 남긴다.
     */
    RedeemOutcome redeem(UUID inviteeId, String code, Instant now, Duration window);

    /**
     * 초대받은 사람이 연습 하나를 끝냈을 때 부른다. 아직 지급하지 않은 초대 기록이 있고 그 연습이 센 연습(리딩 완료·노트가 남은
     * 코칭)이면 한 트랜잭션 안에서 지급 시각을 채우고 Pro 1개월을 준다. 지급 시각을 채운 쪽만 지급하므로 여러 번 불러도 한 번이다.
     * 초대한 사람은 활성 회원이고 {@code monthStart} 이후 받은 보상이 {@code inviterCap} 보다 적을 때만 받는다. 지급하지 않았으면
     * 비어 있다.
     */
    Optional<Reward> rewardIfCounted(UUID inviteeId, Practice practice, UUID practiceId, Instant now, Instant monthStart,
            int inviterCap);

    /** 지급을 부른 연습의 갈래. 갈래마다 「센 연습」 판정이 다르다(practice.days 와 같은 정의). */
    enum Practice {
        /** {@code reading_sessions.status='completed'} */
        READING,
        /** 대화에 노트({@code coach_notes})가 남은 코칭 */
        COACHING
    }

    enum RedeemOutcome {
        REDEEMED,
        ALREADY_REDEEMED,
        WINDOW_CLOSED,
        CODE_NOT_FOUND,
        OWN_CODE,
        /** 넣은 사람의 계정이 활성이 아니다(요청 사이에 탈퇴). */
        ACCOUNT_INACTIVE
    }

    /**
     * @param signedUpAt 가입 시각
     * @param redeemed 코드를 넣었음
     * @param rewarded 초대받은 사람으로 보상을 받았음
     * @param rewardCount 친구 초대로 받은 Pro 기간 수(초대한 사람·받은 사람 모두)
     */
    record State(Instant signedUpAt, boolean redeemed, boolean rewarded, int rewardCount) {
    }

    /** @param inviterId 초대한 사람이 보상을 받았으면 그 사람, 아니면(월 상한·탈퇴) null */
    record Reward(UUID inviteeId, UUID inviterId) {
    }
}
