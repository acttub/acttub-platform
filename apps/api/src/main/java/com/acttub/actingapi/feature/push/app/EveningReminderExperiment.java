package com.acttub.actingapi.feature.push.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

/**
 * 저녁 리마인드 문구 A/B (SOMA-704). A 는 지금까지의 고정 문구, B 는 지난 연습 노트의 "다음에 해볼 한 가지"로 만든
 * 문구다.
 *
 * <p>나누기는 저장하지 않고 회원 id 로 정한다 — 한 사람은 늘 같은 쪽을 받고, 운영 DB 에서도 같은 식으로 다시 셀 수
 * 있다: {@code get_byte(sha256(convert_to('evening_reminder_personal_v1:' || user_id::text, 'UTF8')), 0) % 2 = 1}
 * 이면 B 다. 이름을 바꾸면 사람들이 다시 섞이므로 실험을 새로 할 때만 바꾼다.
 */
public final class EveningReminderExperiment {
    public static final String NAME = "evening_reminder_personal_v1";

    private EveningReminderExperiment() {}

    public enum Variant {
        A("a"), B("b");

        private final String code;

        Variant(String code) {
            this.code = code;
        }

        public String code() {
            return code;
        }
    }

    public static Variant variantOf(UUID userId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((NAME + ":" + userId).getBytes(StandardCharsets.UTF_8));
            return (digest[0] & 1) == 1 ? Variant.B : Variant.A;
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
