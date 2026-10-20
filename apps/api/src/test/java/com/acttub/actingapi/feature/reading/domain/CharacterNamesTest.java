package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class CharacterNamesTest {

    private static final List<String> MACBETH = List.of("맥베스", "뱅코우", "로스", "부인", "마녀 1", "생존자(E)");

    @Test
    @DisplayName("SOMA-593 7-4 3번: 다른 글자 종류가 섞인 이름은 그 글자를 빼고 편집 거리 2 이하의 목록 이름으로")
    void foreignLettersAreDroppedBeforeMatching() {
        assertThat(CharacterNames.fix("맥베س", MACBETH)).isEqualTo("맥베스");
        assertThat(CharacterNames.fix("맥베斯", MACBETH)).isEqualTo("맥베스");
        assertThat(CharacterNames.fix("뱅коу", MACBETH)).isEqualTo("뱅코우");
        assertThat(CharacterNames.fix("ロス", MACBETH)).isEqualTo("로스");
        assertThat(CharacterNames.fix("부in", MACBETH)).isEqualTo("부인");
    }

    @Test
    @DisplayName("SOMA-593 7-4 1·2·4·5번: 그대로 있으면 두고, 띄어쓰기만 다르면 목록 표기로, 세 글자 이상에서 편집 거리 1이면 목록 이름으로, 아니면 새 배역")
    void exactSpacingDistanceOneAndNew() {
        assertThat(CharacterNames.fix("생존자(E)", MACBETH)).isEqualTo("생존자(E)");
        assertThat(CharacterNames.fix("마녀1", MACBETH)).isEqualTo("마녀 1");
        assertThat(CharacterNames.fix("맥베수", MACBETH)).isEqualTo("맥베스");
        assertThat(CharacterNames.fix("맥더프", MACBETH)).isEqualTo("맥더프");
        assertThat(CharacterNames.fix("기자", List.of("여자", "남자", "승욱"))).as("두 글자 이름의 한 글자 차이는 다른 사람").isEqualTo("기자");
        assertThat(CharacterNames.fix("로수", MACBETH)).isEqualTo("로수");
        assertThat(CharacterNames.fix("던컨", List.of())).isEqualTo("던컨");
    }

    @Test
    @DisplayName("SOMA-663: NA·(N)·(na)·내레이션 꼬리가 붙은 이름은 꼬리 없는 목록 이름으로 바꾸지도, 같은 사람으로 묶지도 않는다")
    void narrationIsKeptApartFromTheCharacter() {
        List<String> roster = List.of("제혁", "제씨", "배우1", "재이");
        assertThat(CharacterNames.fix("제혁NA", roster)).as("외국 글자 규칙의 편집 거리 2").isEqualTo("제혁NA");
        assertThat(CharacterNames.fix("제씨na", roster)).isEqualTo("제씨na");
        assertThat(CharacterNames.fix("배우1N.A.", roster)).isEqualTo("배우1N.A.");
        assertThat(CharacterNames.fix("부in", MACBETH)).as("영문 꼬리가 NA 가 아니면 그대로 바로잡는다").isEqualTo("부인");

        for (String narration : List.of("재이 (N)", "태수(NA)", "제씨(na)", "배우1 NA", "제혁NA", "유리(내레이션)")) {
            assertThat(CharacterNames.sameSpeakerKey(narration)).as(narration)
                    .isNotEqualTo(CharacterNames.sameSpeakerKey(narration.replaceAll("\\s*\\(?(N|NA|na|내레이션)\\)?$", "")));
        }
        assertThat(CharacterNames.sameSpeakerKey("제혁 NA")).as("내레이션끼리는 묶는다").isEqualTo(CharacterNames.sameSpeakerKey("제혁NA"));
    }

    @Test
    void editDistanceCountsCodePoints() {
        assertThat(CharacterNames.editDistance("맥베스", "맥베")).isEqualTo(1);
        assertThat(CharacterNames.editDistance("", "로스")).isEqualTo(2);
        assertThat(CharacterNames.editDistance("윤서", "윤서")).isZero();
    }
}
