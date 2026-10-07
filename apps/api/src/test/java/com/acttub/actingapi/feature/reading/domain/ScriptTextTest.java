package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ScriptTextTest {

    private static final String SCRIPT = "윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.";

    @Test
    @DisplayName("reading.script 「같은 글」: 공백만 다른 글, NFD 로 온 글, U+200B 가 섞인 글은 같은 글이다")
    void sameTextUnderNormalization() {
        assertThat(ScriptText.hash("  윤서:\t여기 있을 줄   알았어.\r\n\r\n태오: 어떻게 알았어.  ")).isEqualTo(ScriptText.hash(SCRIPT));
        assertThat(ScriptText.hash("윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어."))
                .isEqualTo(ScriptText.hash(SCRIPT));
        assertThat(ScriptText.hash("​윤서: 여기 있을 줄 알았어.\n​태오: 어떻게 알았어.﻿")).isEqualTo(ScriptText.hash(SCRIPT));
        assertThat(ScriptText.hash("니나: 저는 갈\u0000매기예요.")).as("PDF 추출기의 NUL").isEqualTo(ScriptText.hash("니나: 저는 갈매기예요."));
        assertThat(ScriptText.visible("갈\u0000매기")).isEqualTo("갈매기");
    }

    @Test
    @DisplayName("reading.script 「같은 글」: 한 글자라도 다르면 다른 글이다")
    void oneCharacterApartIsDifferent() {
        assertThat(ScriptText.hash("윤서: 여기 있을 줄 알았어!\n태오: 어떻게 알았어.")).isNotEqualTo(ScriptText.hash(SCRIPT));
        assertThat(ScriptText.hash(SCRIPT)).hasSize(64);
    }

    @Test
    void normalizedCollapsesEveryWhitespaceRunToOneSpace() {
        assertThat(ScriptText.normalized(" 가　　나\n\n다 ")).isEqualTo("가 나 다");
        assertThat(ScriptText.normalized(null)).isEmpty();
        // 제어 문자 U+001F 는 공백류가 아니다 — SQL 의 btrim(…, ' ') 처럼 끝에 남긴다.
        assertThat(ScriptText.normalized("가 \u001F ")).isEqualTo("가 \u001F");
    }

    @Test
    @DisplayName("줄 번호는 빈 줄을 건너뛰어도 원문의 번호다")
    void numberedLinesKeepOriginalNumbers() {
        assertThat(NumberedLine.of("제목\r\n\r\n윤서: 안녕\n   \n태오: 응")).containsExactly(
                new NumberedLine(1, "제목"), new NumberedLine(3, "윤서: 안녕"), new NumberedLine(5, "태오: 응"));
        assertThat(NumberedLine.format(List.of(new NumberedLine(3, "윤서: 안녕"), new NumberedLine(5, "태오: 응"))))
                .isEqualTo("3\t윤서: 안녕\n5\t태오: 응");
        List<NumberedLine> five = NumberedLine.of("a\nb\nc\nd\ne");
        assertThat(NumberedLine.chunks(five, 2)).containsExactly(five.subList(0, 2), five.subList(2, 4), five.subList(4, 5));
    }
}
