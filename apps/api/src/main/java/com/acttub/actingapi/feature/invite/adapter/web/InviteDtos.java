package com.acttub.actingapi.feature.invite.adapter.web;

import java.time.Instant;

import com.acttub.actingapi.feature.invite.app.InviteService.View;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Size;

/** 친구 초대(SOMA-865) 요청·응답. 상대가 누구인지(이름·id)는 싣지 않는다. */
final class InviteDtos {
    private InviteDtos() {
    }

    /** @param code 받은 초대 코드. 대소문자·띄어쓰기·하이픈은 서버가 가린다 */
    record RedeemRequest(@Size(max = 32) String code) {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    record MeResponse(
            String code,
            @JsonProperty("can_redeem") boolean canRedeem,
            @JsonProperty("redeem_until") Instant redeemUntil,
            boolean redeemed,
            boolean rewarded,
            @JsonProperty("reward_count") int rewardCount) {

        static MeResponse of(View view) {
            return new MeResponse(view.code(), view.canRedeem(), view.redeemUntil(), view.redeemed(), view.rewarded(),
                    view.rewardCount());
        }
    }
}
