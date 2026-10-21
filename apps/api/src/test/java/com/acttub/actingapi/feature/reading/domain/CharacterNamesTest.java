package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;

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
    @DisplayName("SOMA-709 2번: 숫자가 다른 이름은 편집 거리 1이어도 목록 이름으로 바꾸지 않는다 — 형사1 ≠ 형사2, 배우1~배우7")
    void numberedNamesAreKeptApart() {
        assertThat(CharacterNames.fix("형사2", List.of("형사1", "반장"))).isEqualTo("형사2");
        assertThat(CharacterNames.fix("형사 2", List.of("형사1"))).isEqualTo("형사 2");
        for (int i = 2; i <= 7; i++) {
            assertThat(CharacterNames.fix("배우" + i, List.of("배우1"))).isEqualTo("배우" + i);
        }
        assertThat(CharacterNames.fix("형사2ж", List.of("형사1"))).as("외국 글자 규칙의 편집 거리 2도").isEqualTo("형사2ж");
        assertThat(CharacterNames.fix("형사1", List.of("형사 1"))).as("띄어쓰기만 다르면 그대로 묶는다").isEqualTo("형사 1");
        assertThat(CharacterNames.fix("맥베수1", List.of("맥베스1"))).as("숫자가 같으면 한 글자 오타는 바로잡는다").isEqualTo("맥베스1");
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
        assertThat(CharacterNames.sameSpeakerKey("박사장 (V.O):")).as("머리의 쌍점이 남은 이름").isEqualTo(CharacterNames.sameSpeakerKey("박사장"));
        assertThat(CharacterNames.sameSpeakerKey("가현:")).isEqualTo("가현");
        assertThat(CharacterNames.sameSpeakerKey("윤성구/음성")).as("빗금 뒤 음성 채널(재생 054)").isEqualTo("윤성구");
        assertThat(CharacterNames.fix("주혁•정배", List.of("주혁", "정배"))).as("• 로 이은 두 사람은 외국 글자가 아니다(재생 049)").isEqualTo("주혁•정배");
        for (String role : List.of("민(영혼)", "재하(어린)", "재하 (젊은 시절)")) {
            assertThat(CharacterNames.sameSpeakerKey(role)).as("괄호 속 역할 표시는 남긴다: " + role)
                    .isNotEqualTo(CharacterNames.sameSpeakerKey(role.replaceAll("\\s*\\(.*\\)$", "")));
        }
        assertThat(CharacterNames.sameSpeakerKey("장석구 (소리)")).isEqualTo("장석구");
    }

    @Test
    @DisplayName("SOMA-663 M7 N1: 이름 전체를 감싼 대괄호·겹따옴표는 외국 글자가 아니라 이름표 표시다 — 안쪽 이름으로 맞추고, 안 맞으면 그대로 둔다")
    void wrappingBracketsAreNameTagMarks() {
        List<String> roster = List.of("[내레이션]", "딱딱이", "가지", "줄기", "뿌리", "[한성전자 광고 음성]", "맥베스");
        assertThat(CharacterNames.fix("[무전]", roster)).as("거리 2 의 「가지」로 바꾸지 않는다").isEqualTo("[무전]");
        assertThat(CharacterNames.fix("“맥베수”", roster)).isEqualTo("맥베스");
        assertThat(CharacterNames.fix("[가지]", roster)).isEqualTo("가지");
        assertThat(CharacterNames.fix("[내레이션]", roster)).isEqualTo("[내레이션]");
        assertThat(CharacterNames.fix("[맥베س", roster)).as("짝 없는 여는 괄호는 전처럼 외국 글자 규칙").isEqualTo("맥베스");
    }

    @Test
    @DisplayName("SOMA-663 M7 N2: 함께 말하기 이름은 사람마다 목록 표기로 — 조각이 목록 한 사람에게만 맞을 때만, 원문 머리 표기와 음성 채널은 그대로")
    void groupNamesAreFixedPerPerson() {
        List<String> roster = List.of("JIMMY", "SANDRINE", "학생1", "학생2", "제혁", "제혁NA", "윤성구");
        assertThat(CharacterNames.fix("JIMMY/SAND", roster)).isEqualTo("JIMMY/SANDRINE");
        assertThat(CharacterNames.fix("JIM, SAND", roster)).isEqualTo("JIMMY, SANDRINE");
        assertThat(CharacterNames.fix("JIM/SAND", roster, Set.of("JIM/SAND"))).as("원문 머리 표기").isEqualTo("JIM/SAND");
        assertThat(CharacterNames.fix("학생/JIMMY", roster)).as("학생1·학생2 둘 다 맞으면 두지 않는다").isEqualTo("학생/JIMMY");
        assertThat(CharacterNames.fix("제혁/SAND", roster)).as("같은 이름이 앞부분 맞춤보다 먼저").isEqualTo("제혁/SANDRINE");
        assertThat(CharacterNames.fix("윤성구/음성", roster)).isEqualTo("윤성구/음성");
        assertThat(CharacterNames.fix("JIMMY/모두", roster)).as("못 맞춘 조각이 있으면 그대로").isEqualTo("JIMMY/모두");
    }

    @Test
    void editDistanceCountsCodePoints() {
        assertThat(CharacterNames.editDistance("맥베스", "맥베")).isEqualTo(1);
        assertThat(CharacterNames.editDistance("", "로스")).isEqualTo(2);
        assertThat(CharacterNames.editDistance("윤서", "윤서")).isZero();
    }
}
