package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.ToDoubleFunction;

import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial.Clip;

/**
 * 리딩 녹음 코치가 말해도 되는 소리를 서버가 잰 값으로 고른다(SOMA-791).
 *
 * <p>코치 모델이 녹음을 듣고 크기·높이를 스스로 판단하면 실제와 반대로 말한 일이 있었다(dev 10/21: 같은 크기인 줄을
 * "작아져요", 오히려 작은 줄을 "크게 들려요"). 그래서 줄마다 잰 값(apps/pron {@code /measure})을 다른 줄의 가운데 값과
 * 비교해 확실히 다른 것만 후보로 넘기고, 모델은 이 후보 안에서만 고른다. 후보가 없으면 소리 이야기 없이 질문만 한다.
 *
 * <p>문턱은 맥 합성 음성(말 빠르기 130~260)과 실제 폰 녹음 6줄로 맞춘 값이다. 정확도는 검증되지 않았다.
 */
public final class RecordingSoundCues {
    /** 다른 줄과 비교하려면 잴 수 있는 줄이 이만큼 있어야 한다. */
    public static final int MIN_MEASURED = 3;
    static final double LOUD_DB = 3.0;
    static final double FAST = 1.3;
    static final double SLOW = 1 / 1.3;
    static final double END_SEMITONES = 3.0;
    static final double END_SEMITONES_DIFF = 3.0;
    static final double END_SOFTER_DB = -6.0;
    static final double END_SOFTER_DIFF = 4.0;
    static final int PAUSE_MIN_MS = 700;
    /** 이보다 긴 쉼이 있는 줄은 대사를 못 하고 기다린 녹음으로 보고 비교에서 뺀다. */
    static final int WAITED_MS = 3_000;
    static final int MIN_SPEECH_MS = 500;

    private RecordingSoundCues() {
    }

    /** 한 줄 녹음의 잰 값. 못 잰 값은 {@code null}. */
    public record Sound(double loudDb, Double rate, int maxPauseMs, Double endSemitones, Double endLoudDb, int speechMs) {
    }

    /** 말해도 되는 소리 하나. {@code says} 는 배우에게 쓸 말의 뼈대, {@code evidence} 는 잰 값. */
    public record Cue(int clip, String says, String evidence) {
    }

    public static List<Cue> pick(List<Clip> clips, Map<Integer, Sound> sounds) {
        List<Clip> usable = clips.stream().filter(c -> usable(sounds.get(c.number()))).toList();
        if (usable.size() < MIN_MEASURED) {
            return List.of();
        }
        List<Cue> cues = new ArrayList<>();
        for (Clip clip : usable) {
            Sound s = sounds.get(clip.number());
            List<Sound> others = usable.stream().filter(o -> o != clip).map(o -> sounds.get(o.number())).toList();
            double loud = s.loudDb() - median(others, Sound::loudDb);
            if (Math.abs(loud) >= LOUD_DB) {
                cues.add(new Cue(clip.number(), loud > 0 ? "다른 대사들보다 크게 들려요" : "다른 대사들보다 작게 들려요",
                        fmt("크기 %+.1fdB(다른 줄 가운데 값 대비)", loud)));
            }
            List<Sound> rated = others.stream().filter(o -> o.rate() != null).toList();
            if (s.rate() != null && rated.size() >= MIN_MEASURED - 1) {
                double ratio = s.rate() / median(rated, Sound::rate);
                if (ratio >= FAST || ratio <= SLOW) {
                    cues.add(new Cue(clip.number(), ratio > 1 ? "다른 대사들보다 빨라요" : "다른 대사들보다 느려요",
                            fmt("빠르기 %.1f글자/초, 다른 줄의 %.2f배", s.rate(), ratio)));
                }
            }
            List<Sound> pitched = others.stream().filter(o -> o.endSemitones() != null).toList();
            if (s.endSemitones() != null && pitched.size() >= MIN_MEASURED - 1) {
                double diff = s.endSemitones() - median(pitched, Sound::endSemitones);
                if (s.endSemitones() <= -END_SEMITONES && diff <= -END_SEMITONES_DIFF) {
                    cues.add(new Cue(clip.number(), "다른 대사들보다 끝이 더 내려가요",
                            fmt("끝 높이 %+.1f반음, 다른 줄보다 %+.1f반음", s.endSemitones(), diff)));
                } else if (s.endSemitones() >= END_SEMITONES && diff >= END_SEMITONES_DIFF) {
                    cues.add(new Cue(clip.number(), "다른 대사들과 달리 끝이 올라가요",
                            fmt("끝 높이 %+.1f반음, 다른 줄보다 %+.1f반음", s.endSemitones(), diff)));
                }
            }
            List<Sound> ended = others.stream().filter(o -> o.endLoudDb() != null).toList();
            if (s.endLoudDb() != null && ended.size() >= MIN_MEASURED - 1) {
                double diff = s.endLoudDb() - median(ended, Sound::endLoudDb);
                if (s.endLoudDb() <= END_SOFTER_DB && diff <= -END_SOFTER_DIFF) {
                    cues.add(new Cue(clip.number(), "끝으로 갈수록 소리가 작아져요",
                            fmt("끝 크기 %+.1fdB, 다른 줄보다 %+.1fdB", s.endLoudDb(), diff)));
                }
            }
            if (s.maxPauseMs() >= PAUSE_MIN_MS && median(others, o -> o.maxPauseMs()) < PAUSE_MIN_MS / 2.0) {
                cues.add(new Cue(clip.number(), "다른 대사들과 달리 중간에 한 번 길게 쉬어요",
                        fmt("가장 긴 쉼 %.1f초", s.maxPauseMs() / 1000.0)));
            }
        }
        return List.copyOf(cues);
    }

    /** 모델에게 보일 칸. 후보가 없으면 소리 이야기를 하지 말라는 칸. */
    public static String block(List<Cue> cues) {
        StringBuilder out = new StringBuilder("\n[서버가 잰 소리]\n");
        if (cues.isEmpty()) {
            return out.append("다른 대사와 확실히 다르게 잰 소리가 없다.\n").toString();
        }
        for (Cue cue : cues) {
            out.append("- 녹음 ").append(cue.clip()).append(": ").append(cue.says())
                    .append(" (").append(cue.evidence()).append(")\n");
        }
        return out.toString();
    }

    private static boolean usable(Sound s) {
        return s != null && s.maxPauseMs() <= WAITED_MS && s.speechMs() >= MIN_SPEECH_MS;
    }

    private static double median(List<Sound> sounds, ToDoubleFunction<Sound> value) {
        double[] v = sounds.stream().mapToDouble(value).sorted().toArray();
        if (v.length == 0) {
            return 0;
        }
        return v.length % 2 == 1 ? v[v.length / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    }

    private static String fmt(String pattern, Object... args) {
        return String.format(Locale.ROOT, pattern, args);
    }
}
