package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Random;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 앱 {@code apps/mobile/tests/reading-match.test.mjs} 의 입력·기대값을 그대로 옮겼다. */
class LineMatchTest {

    @Test
    @DisplayName("reading.memorization: 대조는 정규화(괄호 안 제거, 문자·숫자만, 소문자) 뒤 자모 편집거리 유사도 0.72 이상이면 통과다")
    void normalizesThenPassesAtTheThreshold() {
        assertThat(LineMatch.normalize("(웃으며) 그런가, 정말?")).isEqualTo("그런가정말");
        assertThat(LineMatch.compare("여기 있을 줄 알았어", "여기 있을 줄 알았어.")).isEqualTo(LineMatch.Result.PASS);
        assertThat(LineMatch.compare("전혀 다른 말이야 이건", "여기 있을 줄 알았어.")).isEqualTo(LineMatch.Result.MISS);
    }

    @Test
    @DisplayName("reading.memorization: 유사도 0.72는 통과, 0.71은 미달이다(경계)")
    void boundary() {
        String target = "가나다라마바사아자차카타파하";
        assertThat(LineMatch.similarity(target, target)).isEqualTo(1.0);
        assertThat(LineMatch.compare("가나다라마바사아자차카타파하", target)).isEqualTo(LineMatch.Result.PASS);
        String said71 = "가나다라마바사아자차카타xxxxxxxxxxxx";
        assertThat(LineMatch.similarity(said71, target)).isEqualTo(0.6666666666666667);
        assertThat(LineMatch.compare(said71, target)).isEqualTo(LineMatch.Result.MISS);

        String hundred = "a".repeat(100);
        String exactly72 = "a".repeat(72) + "b".repeat(28);
        String exactly71 = "a".repeat(71) + "b".repeat(29);
        assertThat(LineMatch.similarity(exactly72, hundred)).isEqualTo(0.72);
        assertThat(LineMatch.compare(exactly72, hundred)).isEqualTo(LineMatch.Result.PASS);
        assertThat(LineMatch.similarity(exactly71, hundred)).isEqualTo(0.71);
        assertThat(LineMatch.compare(exactly71, hundred)).isEqualTo(LineMatch.Result.MISS);
    }

    @Test
    @DisplayName("reading.session: 원문이나 말한 것이 1,000자를 넘으면 대조하지 않고 수동 진행을 준다(미달로 기록하지 않음)")
    void tooLong() {
        String longText = "가".repeat(1001);
        assertThat(LineMatch.compare("가", longText)).isEqualTo(LineMatch.Result.TOO_LONG);
        assertThat(LineMatch.compare(longText, "가")).isEqualTo(LineMatch.Result.TOO_LONG);
        assertThat(LineMatch.compare("가".repeat(1000), "가".repeat(1000))).isEqualTo(LineMatch.Result.PASS);
    }

    @Test
    @DisplayName("reading.session: 인식 불가·무발화는 미달로 세지 않는다")
    void noSpeech() {
        assertThat(LineMatch.compare("", "여기")).isEqualTo(LineMatch.Result.NO_SPEECH);
        assertThat(LineMatch.compare("   ...", "여기")).isEqualTo(LineMatch.Result.NO_SPEECH);
    }

    @Test
    @DisplayName("편집 거리는 표를 채우는 정의와 같다 — 64자 경계를 넘는 여러 블록과 한쪽만 긴 글에서도")
    void bitParallelDistanceEqualsTheTableDefinition() {
        assertThat(LineMatch.levenshtein("kitten", "sitting")).isEqualTo(3);
        assertThat(LineMatch.levenshtein("a".repeat(130), "b" + "a".repeat(128))).isEqualTo(2);
        Random random = new Random(593);
        String letters = "ㄱㄴㄷㅏㅓabc";
        for (int round = 0; round < 2000; round++) {
            String a = randomText(random, letters, random.nextInt(200));
            String b = randomText(random, letters, random.nextInt(200));
            assertThat(LineMatch.levenshtein(a, b)).as(a + " / " + b).isEqualTo(tableDistance(a, b));
        }
    }

    private static String randomText(Random random, String letters, int length) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < length; i++) {
            out.append(letters.charAt(random.nextInt(letters.length())));
        }
        return out.toString();
    }

    private static int tableDistance(String a, String b) {
        int[][] d = new int[a.length() + 1][b.length() + 1];
        for (int i = 0; i <= a.length(); i++) {
            d[i][0] = i;
        }
        for (int j = 0; j <= b.length(); j++) {
            d[0][j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            for (int j = 1; j <= b.length(); j++) {
                int substitution = d[i - 1][j - 1] + (a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1);
                d[i][j] = Math.min(Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1), substitution);
            }
        }
        return d[a.length()][b.length()];
    }
}
