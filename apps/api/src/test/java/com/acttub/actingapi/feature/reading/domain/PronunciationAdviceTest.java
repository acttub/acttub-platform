package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.reading.domain.PronunciationAdvice.Detail;
import com.acttub.actingapi.feature.reading.domain.PronunciationAdvice.Slot;
import org.junit.jupiter.api.Test;

class PronunciationAdviceTest {

    @Test
    void 자리가_다른_자음은_두_자리를_비교하고_입술로_새면_입술을_떼라고_한다() {
        Detail d = PronunciationAdvice.of("안녕", "안명", Slot.ONSET, "ㄴ", "ㅁ", "녕", "녀");
        assertThat(d.where()).isEqualTo("'녕'의 첫소리 ㄴ이 ㅁ에 가까웠어요");
        assertThat(d.diff()).isEqualTo("둘 다 콧소리예요. ㄴ은 혀끝을 윗잇몸에 대고, ㅁ은 두 입술을 닫아요.");
        assertThat(d.practice()).isEqualTo("입술은 뗀 채 혀끝을 윗잇몸에 대고 '녀-녀-녕', 그다음 '안녕'.");
    }

    @Test
    void 자리가_같은_자음은_내는_방법만_비교한다() {
        Detail d = PronunciationAdvice.of("다리", "타리", Slot.ONSET, "ㄷ", "ㅌ", "다", "다");
        assertThat(d.diff()).isEqualTo("같은 자리에서 나는 소리예요. ㄷ은 힘과 바람을 빼고 내고, ㅌ은 바람을 세게 내요.");
        assertThat(d.practice()).isEqualTo("바람을 빼고 약하게 '다-다-다', 그다음 '다리'.");
    }

    @Test
    void 받침은_받침_뺀_소리_다음에_닫으며_끝내게_한다() {
        Detail d = PronunciationAdvice.of("밥", "박", Slot.CODA, "ㅂ", "ㄱ", "밥", "바");
        assertThat(d.where()).isEqualTo("'밥'의 받침 ㅂ이 ㄱ에 가까웠어요");
        assertThat(d.kind()).isEqualTo("받침이 바뀜");
        assertThat(d.diff()).isEqualTo("ㅂ은 두 입술을 닫고, ㄱ은 혀 뒤를 입천장 안쪽에 붙여요.");
        assertThat(d.practice()).isEqualTo("'바' 다음에 두 입술을 닫으며 끝내요. '밥-밥'.");
    }

    @Test
    void 모음은_입_모양을_비교한다() {
        Detail d = PronunciationAdvice.of("머리", "모리", Slot.VOWEL, "ㅓ", "ㅗ", "머", "머");
        assertThat(d.where()).isEqualTo("'머'의 모음 ㅓ가 ㅗ에 가까웠어요");
        assertThat(d.diff()).isEqualTo("ㅓ는 입술을 편 채 턱을 내리고, ㅗ는 입술을 둥글게 모아 내밀어요.");
        assertThat(d.practice()).isEqualTo("입술을 편 채 턱을 내리고 '머-머-머', 그다음 '머리'.");
        assertThat(d.sentence()).startsWith("'모리'처럼 들렸어요. '머'의 모음 ㅓ가 ㅗ에 가까웠어요(모음이 바뀜). ");
    }

    @Test
    void 표에_없는_소리면_분석을_만들지_않는다() {
        assertThat(PronunciationAdvice.of("와", "워", Slot.VOWEL, "ㅘ", "ㅝ", "와", "와")).isNull();
    }
}
