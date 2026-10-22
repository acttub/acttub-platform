package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Clip;
import com.acttub.actingapi.feature.reading.domain.RecordingSoundCues.Cue;
import com.acttub.actingapi.feature.reading.domain.RecordingSoundCues.Sound;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.Test;

/** 리딩 녹음 코치가 말해도 되는 소리는 다른 줄과 확실히 다르게 잰 것뿐이다(SOMA-791). */
class RecordingSoundCuesTest {
    private static Clip clip(int n) {
        return new Clip(n, "녹음 " + n, UUID.randomUUID(), "k" + n, "audio/mp4", "대사 " + n);
    }

    private static Sound sound(double loud, double rate) {
        return new Sound(loud, rate, 0, -1.0, -1.0, 2_000);
    }

    private static final List<Clip> CLIPS = List.of(clip(1), clip(2), clip(3), clip(4));

    @Test
    void 비슷한_줄들에서는_아무것도_고르지_않는다() {
        // dev 10/21 폰 녹음: 크기는 -16.8~-19.8dB 로 3dB 안에 모여 있었다 — 코치가 "크게 들려요"라고 하면 안 된다.
        Map<Integer, Sound> sounds = Map.of(1, sound(-17.4, 7.3), 2, sound(-16.9, 6.1), 3, sound(-18.6, 6.6), 4, sound(-19.1, 8.2));
        assertThat(RecordingSoundCues.pick(CLIPS, sounds)).isEmpty();
        assertThat(RecordingSoundCues.block(List.of())).contains("확실히 다르게 잰 소리가 없다");
    }

    @Test
    void 크기와_빠르기가_확실히_다른_줄만_고른다() {
        Map<Integer, Sound> sounds = Map.of(1, sound(-17, 5.0), 2, sound(-12.5, 5.1), 3, sound(-17.5, 7.0), 4, sound(-16.8, 4.9));
        List<Cue> cues = RecordingSoundCues.pick(CLIPS, sounds);
        assertThat(cues).extracting(Cue::clip, Cue::says).containsExactlyInAnyOrder(
                Tuple.tuple(2, "다른 대사들보다 크게 들려요"),
                Tuple.tuple(3, "다른 대사들보다 빨라요"));
        assertThat(RecordingSoundCues.block(cues)).contains("- 녹음 2: 다른 대사들보다 크게 들려요 (크기 +4.5dB");
    }

    @Test
    void 기다린_녹음과_못_잰_줄은_빼고_세_줄이_안_되면_고르지_않는다() {
        Map<Integer, Sound> sounds = Map.of(
                1, new Sound(-24, 0.4, 40_000, 0.0, -0.7, 6_540), 2, sound(-12, 5.0), 3, sound(-17, 5.0));
        assertThat(RecordingSoundCues.pick(CLIPS, sounds)).isEmpty();
    }

    @Test
    void 끝이_다른_줄보다_확실히_내려가거나_올라가면_고른다() {
        Map<Integer, Sound> sounds = Map.of(
                1, new Sound(-17, 5.0, 0, -6.5, -1.0, 2_000), 2, new Sound(-17, 5.0, 0, -1.0, -1.0, 2_000),
                3, new Sound(-17, 5.0, 0, 4.0, -1.0, 2_000), 4, new Sound(-17, 5.0, 0, -0.5, -1.0, 2_000));
        assertThat(RecordingSoundCues.pick(CLIPS, sounds)).extracting(Cue::clip, Cue::says).containsExactlyInAnyOrder(
                Tuple.tuple(1, "다른 대사들보다 끝이 더 내려가요"),
                Tuple.tuple(3, "다른 대사들과 달리 끝이 올라가요"));
    }
}
