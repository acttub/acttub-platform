package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import java.util.stream.IntStream;
import com.acttub.actingapi.feature.push.app.EveningReminderExperiment.Variant;
import org.junit.jupiter.api.Test;

class EveningReminderExperimentTest {

    /** 한 사람은 매번 같은 쪽이다. */
    @Test void sameUserAlwaysGetsSameVariant() {
        UUID id = UUID.randomUUID();
        assertThat(EveningReminderExperiment.variantOf(id)).isEqualTo(EveningReminderExperiment.variantOf(id));
    }

    /**
     * 운영 DB 에서 같은 식으로 다시 셀 수 있어야 한다. 아래 기대값은 Postgres 의
     * {@code get_byte(sha256(convert_to('evening_reminder_personal_v1:' || id::text, 'UTF8')), 0) % 2} 와 같은 식을
     * 따른다 — 첫 바이트의 마지막 비트가 1 이면 B 다.
     */
    @Test void followsTheSqlRule() throws Exception {
        UUID id = UUID.fromString("00000000-0000-0000-0000-000000000001");
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
                .digest(("evening_reminder_personal_v1:" + id).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Variant expected = (digest[0] & 1) == 1 ? Variant.B : Variant.A;
        assertThat(EveningReminderExperiment.variantOf(id)).isEqualTo(expected);
    }

    /** 대략 반반으로 나뉜다. */
    @Test void splitsRoughlyInHalf() {
        long b = IntStream.range(0, 4000).mapToObj(i -> UUID.randomUUID())
                .filter(id -> EveningReminderExperiment.variantOf(id) == Variant.B).count();
        assertThat(b).isBetween(1700L, 2300L);
    }
}
