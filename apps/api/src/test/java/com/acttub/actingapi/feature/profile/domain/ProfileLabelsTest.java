package com.acttub.actingapi.feature.profile.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Arrays;
import java.util.List;

import com.acttub.actingapi.platform.schema.ActingDirection;
import com.acttub.actingapi.platform.schema.ActingExperience;
import com.acttub.actingapi.platform.schema.ActingGoal;
import com.acttub.actingapi.platform.schema.PgEnum;
import com.acttub.actingapi.platform.schema.ProfileGender;
import org.junit.jupiter.api.Test;

/**
 * account.profile: 저장 값마다 표시말이 하나씩 있다. 값 목록은 DB CHECK·Java enum·표시말 세 곳에 있고,
 * 앞의 둘은 {@code ValueCheckCatalogIT} 가 묶는다 — 여기서 셋째를 enum 에 묶는다. 값을 더하고 표시말을
 * 빠뜨리면 그 값을 고른 배우의 코치 대화가 프로필 없이 간다(읽기 실패는 대화를 막지 않는다).
 */
class ProfileLabelsTest {

    @Test
    void everyStoredValueHasALabelFromTheSignupScreen() {
        assertThat(labels(ProfileGender.class, ProfileLabels::gender))
                .containsExactly("여성", "남성", "선택 안 함");
        assertThat(ProfileLabels.directions(values(ActingDirection.class)))
                .containsExactly("매체(TV·영화)", "무대(연극·뮤지컬)");
        assertThat(labels(ActingExperience.class, ProfileLabels::experience))
                .containsExactly("입문 전", "입시생", "1년 미만", "1–3년", "3–5년", "5년 이상");
        assertThat(labels(ActingGoal.class, ProfileLabels::goal))
                .containsExactly("취미", "공연·오디션", "전문 배우");
    }

    @Test
    void unknownValueIsNotSilentlyPassedThrough() {
        assertThatThrownBy(() -> ProfileLabels.experience("y10"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("y10");
    }

    private static <E extends Enum<E> & PgEnum> List<String> values(Class<E> vocabulary) {
        return Arrays.stream(vocabulary.getEnumConstants()).map(PgEnum::dbValue).toList();
    }

    private static <E extends Enum<E> & PgEnum> List<String> labels(
            Class<E> vocabulary, java.util.function.UnaryOperator<String> label) {
        return values(vocabulary).stream().map(label).toList();
    }
}
