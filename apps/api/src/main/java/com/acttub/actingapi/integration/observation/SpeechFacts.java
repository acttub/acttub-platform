package com.acttub.actingapi.integration.observation;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

/** SOMA-518 speech_facts.py의 계산. 파일·모델·시계에 의존하지 않는 순수 함수다. */
public final class SpeechFacts {
    static final double PAUSE_MIN = 0.5;
    static final double MIN_CHUNK = 2.0;

    private SpeechFacts() {
    }

    public record Word(String word, double start, double end) {
        public Word {
            if (word == null || !Double.isFinite(start) || !Double.isFinite(end)
                    || start < 0 || end < start) {
                throw new IllegalArgumentException("invalid transcription word or timestamp");
            }
        }
    }

    public static SpeechAnalysis calculate(String transcript, List<Word> words) {
        if (words.isEmpty()) {
            return new SpeechAnalysis(transcript, 0, List.of(), List.of());
        }
        List<List<Word>> chunks = new ArrayList<>();
        List<Word> current = new ArrayList<>();
        current.add(words.getFirst());
        for (int i = 1; i < words.size(); i++) {
            if (words.get(i).start() - words.get(i - 1).end() >= PAUSE_MIN) {
                chunks.add(current);
                current = new ArrayList<>();
            }
            current.add(words.get(i));
        }
        chunks.add(current);

        // 병합할 때마다 처음부터 다시 훑으며, 같은 간격이면 앞쪽을 택한다.
        boolean changed = true;
        while (changed && chunks.size() > 1) {
            changed = false;
            for (int i = 0; i < chunks.size(); i++) {
                List<Word> chunk = chunks.get(i);
                if (chunk.getLast().end() - chunk.getFirst().start() >= MIN_CHUNK) {
                    continue;
                }
                double prev = i > 0
                        ? chunk.getFirst().start() - chunks.get(i - 1).getLast().end()
                        : Double.POSITIVE_INFINITY;
                double next = i + 1 < chunks.size()
                        ? chunks.get(i + 1).getFirst().start() - chunk.getLast().end()
                        : Double.POSITIVE_INFINITY;
                int neighbor = prev <= next ? i - 1 : i + 1;
                int lo = Math.min(i, neighbor);
                int hi = Math.max(i, neighbor);
                chunks.get(lo).addAll(chunks.remove(hi));
                changed = true;
                break;
            }
        }

        double spoken = spoken(words);
        double avg = spoken == 0 ? 0 : syllables(words) / spoken;
        List<SpeechAnalysis.Chunk> rates = new ArrayList<>();
        for (List<Word> chunk : chunks) {
            double duration = spoken(chunk);
            Double rate = duration > 0.4 ? syllables(chunk) / duration : null;
            Double delta = rate == null || avg == 0 ? null : (rate - avg) / avg * 100;
            String mark = delta == null ? null
                    : delta > 12 ? "빠름" : delta < -12 ? "느림" : "보통";
            rates.add(new SpeechAnalysis.Chunk(
                    ms(chunk.getFirst().start()), ms(chunk.getLast().end()),
                    rate == null ? null : rounded(rate, 1),
                    delta == null ? null : (int) rounded(delta, 0), mark,
                    chunk.stream().map(Word::word).collect(Collectors.joining(" "))));
        }
        // 원래 간격으로 정렬한 뒤 반올림해야 가까운 길이끼리 순서가 바뀌지 않는다.
        List<SpeechAnalysis.Pause> pauses = pauses(words).stream()
                .sorted(Comparator.comparingDouble(SpeechAnalysis.Pause::seconds).reversed())
                .limit(8)
                .map(p -> new SpeechAnalysis.Pause(
                        p.atMs(), rounded(p.seconds(), 1), p.after(), p.before()))
                .toList();
        return new SpeechAnalysis(transcript, rounded(avg, 1), pauses, rates);
    }

    /** 잘라내기 전의 사이. 패키지 테스트가 전체 개수도 Python 원본과 대조한다. */
    static List<SpeechAnalysis.Pause> pauses(List<Word> words) {
        List<SpeechAnalysis.Pause> pauses = new ArrayList<>();
        for (int i = 1; i < words.size(); i++) {
            Word a = words.get(i - 1);
            Word b = words.get(i);
            double gap = b.start() - a.end();
            if (gap >= PAUSE_MIN) {
                pauses.add(new SpeechAnalysis.Pause(ms(a.end()), gap, a.word(), b.word()));
            }
        }
        return pauses;
    }

    static int syllables(String word) {
        int hangul = (int) word.codePoints().filter(c -> c >= '가' && c <= '힣').count();
        return hangul == 0 ? word.codePointCount(0, word.length()) : hangul;
    }

    private static int syllables(List<Word> words) {
        return words.stream().mapToInt(w -> syllables(w.word())).sum();
    }

    private static double spoken(List<Word> words) {
        double total = 0;
        for (Word word : words) {
            total += word.end() - word.start();
        }
        return total;
    }

    private static long ms(double seconds) {
        return Math.round(seconds * 1000);
    }

    private static double rounded(double value, int scale) {
        // Python의 float 포맷과 같은 이진 실수의 half-even 반올림.
        return new BigDecimal(value).setScale(scale, RoundingMode.HALF_EVEN).doubleValue();
    }
}
