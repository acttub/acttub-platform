package com.acttub.actingapi.feature.appconfig.app;

import java.util.List;
import java.util.Map;

/**
 * 앱 설정(SOMA-939) — 운영 중에 바꿀 일이 있는 앱의 숫자·문구. 앱 출시 없이 바꾸려고 서버가 내려준다.
 *
 * <p>값은 기본 파일(resources {@code app-config/defaults.json})에 서버 설정 {@code APP_CONFIG_FILE} 이 가리키는 파일을
 * 덮어 만든다. 덮은 값이 잘못됐으면 그 칸만 기본값으로 돌린다 — 설정 하나를 잘못 써도 앱이 깨지지 않게.
 *
 * <p>서버가 이미 막는 규칙(챌린지 영상 60초·기간 7/14일·같이 만들기 감정·독백 통과선)은 파일로 바꾸지 않고 서버 규칙과 같은 값을
 * 그대로 싣는다({@link ServerRules}). 앱이 보이는 값과 서버가 받는 값이 어긋나지 않게.
 */
public record AppConfig(Rating rating, Reading reading, Cocreate cocreate, Map<String, List<String>> homeTips,
        Challenge challenge) {

    /** 앱 평가 요청 — 코칭·리딩 몇 번마다 묻는지, 최소 간격(일), 최대 횟수. */
    public record Rating(int coachEvery, int readingEvery, int minGapDays, int maxAsks) {
    }

    /** 리딩 자동 넘김(침묵 감지·말 끝 여유·말한 비율)과 독백 판정 기준. monologuePass 는 서버 규칙이다. */
    public record Reading(double vadThreshold, int silenceMs, int minSpeechMs, int maxListenMs, int speechEndGraceMs,
            double advanceCoverage, double monologuePass, double monologueMissedBelow, double monologueNextAt,
            int monologueTouchMin) {
    }

    /** 대본 같이 만들기 칩. 감정은 서버가 받는 목록 안에서만 고른다(보이는 순서만 바꾼다). 상황은 자유 글이다. */
    public record Cocreate(List<String> emotions, List<String> situations) {
    }

    /** 챌린지 참여 영상 길이(초)와 기간(일). 최대 길이·기간은 서버 규칙이다. */
    public record Challenge(int entryMinSeconds, int entryMaxSeconds, List<Integer> durationsDays) {
    }

    /** 서버가 이미 막는 규칙 — 파일로 바꾸지 않는다. 각 도메인 규칙과 같은지는 테스트가 잠근다. */
    public record ServerRules(double monologuePass, int entryMaxSeconds, List<Integer> durationsDays,
            List<String> allowedEmotions) {
    }

    /**
     * 덮은 값을 칸마다 검사해 잘못된 칸은 기본값으로 돌리고, 서버 규칙 값을 넣는다.
     *
     * @param merged 기본 파일에 덮을 파일을 합친 값(서버 규칙 칸은 무시한다)
     * @param defaults 기본 파일 값
     */
    public static AppConfig validated(AppConfig merged, AppConfig defaults, ServerRules rules) {
        Rating r = merged.rating() == null ? defaults.rating() : merged.rating();
        Rating d = defaults.rating();
        Rating rating = new Rating(positive(r.coachEvery(), d.coachEvery()), positive(r.readingEvery(), d.readingEvery()),
                positive(r.minGapDays(), d.minGapDays()), positive(r.maxAsks(), d.maxAsks()));

        Reading x = merged.reading() == null ? defaults.reading() : merged.reading();
        Reading dx = defaults.reading();
        Reading reading = new Reading(
                fraction(x.vadThreshold(), dx.vadThreshold()),
                positive(x.silenceMs(), dx.silenceMs()),
                positive(x.minSpeechMs(), dx.minSpeechMs()),
                positive(x.maxListenMs(), dx.maxListenMs()),
                positive(x.speechEndGraceMs(), dx.speechEndGraceMs()),
                fraction(x.advanceCoverage(), dx.advanceCoverage()),
                rules.monologuePass(),
                fraction(x.monologueMissedBelow(), dx.monologueMissedBelow()),
                fraction(x.monologueNextAt(), dx.monologueNextAt()),
                positive(x.monologueTouchMin(), dx.monologueTouchMin()));

        Cocreate c = merged.cocreate() == null ? defaults.cocreate() : merged.cocreate();
        List<String> emotions = c.emotions() == null ? List.of()
                : c.emotions().stream().filter(rules.allowedEmotions()::contains).distinct().toList();
        Cocreate cocreate = new Cocreate(
                emotions.isEmpty() ? defaults.cocreate().emotions() : emotions,
                texts(c.situations(), defaults.cocreate().situations()));

        Map<String, List<String>> tips = merged.homeTips() == null ? defaults.homeTips() : merged.homeTips();
        Map<String, List<String>> homeTips = new java.util.TreeMap<>();
        defaults.homeTips().forEach((locale, fallback) -> homeTips.put(locale, texts(tips.get(locale), fallback)));

        Challenge ch = merged.challenge() == null ? defaults.challenge() : merged.challenge();
        int min = positive(ch.entryMinSeconds(), defaults.challenge().entryMinSeconds());
        Challenge challenge = new Challenge(min < rules.entryMaxSeconds() ? min : defaults.challenge().entryMinSeconds(),
                rules.entryMaxSeconds(), rules.durationsDays());

        return new AppConfig(rating, reading, cocreate, Map.copyOf(homeTips), challenge);
    }

    private static int positive(int value, int fallback) {
        return value > 0 ? value : fallback;
    }

    private static double fraction(double value, double fallback) {
        return value > 0 && value <= 1 && Double.isFinite(value) ? value : fallback;
    }

    private static List<String> texts(List<String> values, List<String> fallback) {
        if (values == null) return fallback;
        List<String> kept = values.stream().filter(v -> v != null && !v.isBlank()).map(String::strip).toList();
        return kept.isEmpty() ? fallback : kept;
    }
}
