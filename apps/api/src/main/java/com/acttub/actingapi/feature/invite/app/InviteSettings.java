package com.acttub.actingapi.feature.invite.app;

import java.time.Duration;

/**
 * 친구 초대 설정(SOMA-865). 값은 {@code InviteConfiguration} 이 환경 변수에서 읽는다.
 *
 * @param enabled {@code INVITE_ENABLED}(기본 false). 꺼져 있으면 경로가 404 {@code invite_unavailable} 이고 연습 완료를 듣지 않는다
 * @param inviterMonthlyCap {@code INVITE_INVITER_MONTHLY_CAP}(기본 5). 초대한 사람이 한국 시간 한 달에 받는 보상 수의 상한
 * @param redeemWindow {@code INVITE_REDEEM_WINDOW_DAYS}(기본 7). 가입 뒤 코드를 넣을 수 있는 기간
 */
public record InviteSettings(boolean enabled, int inviterMonthlyCap, Duration redeemWindow) {

    public InviteSettings {
        if (inviterMonthlyCap < 0) {
            throw new IllegalArgumentException("INVITE_INVITER_MONTHLY_CAP must not be negative");
        }
        if (redeemWindow == null || redeemWindow.isNegative() || redeemWindow.isZero()) {
            throw new IllegalArgumentException("INVITE_REDEEM_WINDOW_DAYS must be positive");
        }
    }
}
