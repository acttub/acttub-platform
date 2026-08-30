package com.acttub.actingapi.feature.coach.domain;

import java.text.Normalizer;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * 코치가 같은 세션에서 이미 물은 질문을 다시 내는지 판정한다.
 *
 * <p>질문 상한(8번)은 있어도 되풀이를 막는 장치는 프롬프트 문장 한 줄뿐이었다. 여기는
 * <b>서버 문자열 연산만</b>으로 판정한다 — 유료 호출도 임베딩도 없다. 세 규칙을 순서대로
 * 건다: 정규화 후 같은 문장(exact) → 글자 3-gram Jaccard(trigram) → 마지막 물음의 핵
 * 2-gram Jaccard(question_core). 임계값은 초기값이고 반복 질문율 기준선이 나오면 조정한다.
 *
 * <p>배우 턴은 보지 않는다. 코치가 배우 말을 근거로 인용하는 것은 설계된 동작이지
 * 반복이 아니다.
 */
public final class RepeatedQuestion {

    static final double TRIGRAM_THRESHOLD = 0.6;
    static final double QUESTION_CORE_THRESHOLD = 0.7;
    /** 절 경계. 마지막 물음표 앞에서 이 문자들로 잘라 마지막 절만 질문 핵으로 본다. */
    private static final java.util.regex.Pattern CLAUSE_BOUNDARY =
            java.util.regex.Pattern.compile("[,.!?。…\\n;:]");

    /** 무엇과(earlier) 어느 규칙으로(rule) 얼마나(similarity) 겹쳤는지. */
    public record Match(String earlier, String rule, double similarity) {
    }

    private RepeatedQuestion() {
    }

    public static Optional<Match> find(String candidate, List<CoachTurnSnapshot> turns) {
        String normalizedCandidate = normalize(candidate);
        if (normalizedCandidate.isEmpty() || turns == null || turns.isEmpty()) {
            return Optional.empty();
        }
        Set<String> candidateTrigrams = ngrams(normalizedCandidate, 3);
        String candidateCore = questionCore(candidate);
        Set<String> candidateCoreBigrams = candidateCore == null ? Set.of() : ngrams(candidateCore, 2);

        Match best = null;
        for (CoachTurnSnapshot turn : turns) {
            if (!"ai".equals(turn.role())) {
                continue;
            }
            String normalizedEarlier = normalize(turn.text());
            if (normalizedEarlier.isEmpty()) {
                continue;
            }
            Match match = null;
            if (normalizedEarlier.equals(normalizedCandidate)) {
                match = new Match(turn.text(), "exact", 1.0);
            } else {
                double trigram = jaccard(candidateTrigrams, ngrams(normalizedEarlier, 3));
                if (trigram >= TRIGRAM_THRESHOLD) {
                    match = new Match(turn.text(), "trigram", trigram);
                } else if (!candidateCoreBigrams.isEmpty()) {
                    String earlierCore = questionCore(turn.text());
                    double core = earlierCore == null
                            ? 0.0
                            : jaccard(candidateCoreBigrams, ngrams(earlierCore, 2));
                    if (core >= QUESTION_CORE_THRESHOLD) {
                        match = new Match(turn.text(), "question_core", core);
                    }
                }
            }
            if (match != null && (best == null || match.similarity() > best.similarity())) {
                best = match;
            }
        }
        return Optional.ofNullable(best);
    }

    /** NFKC → 소문자 → 글자·숫자만 남긴다. 공백·문장부호·전각 차이는 반복 판정과 무관하다. */
    static String normalize(String text) {
        if (text == null) {
            return "";
        }
        String normalized = Normalizer.normalize(text, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT);
        StringBuilder kept = new StringBuilder(normalized.length());
        normalized.codePoints()
                .filter(Character::isLetterOrDigit)
                .forEach(kept::appendCodePoint);
        return kept.toString();
    }

    static Set<String> ngrams(String text, int size) {
        Set<String> grams = new HashSet<>();
        int[] codePoints = text.codePoints().toArray();
        for (int index = 0; index + size <= codePoints.length; index++) {
            grams.add(new String(codePoints, index, size));
        }
        return grams;
    }

    static double jaccard(Set<String> left, Set<String> right) {
        if (left.isEmpty() || right.isEmpty()) {
            return 0.0;
        }
        int shared = 0;
        for (String gram : left) {
            if (right.contains(gram)) {
                shared++;
            }
        }
        int union = left.size() + right.size() - shared;
        return union == 0 ? 0.0 : (double) shared / union;
    }

    /**
     * 마지막 물음표 앞의 <b>마지막 절</b>(쉼표·마침표 뒤)을 정규화한 것. 앞말은 매번 달라도
     * 질문 자체는 같은 경우를 잡는다. 물음표가 없으면 null — 질문이 아닌 문장은 이 규칙의
     * 대상이 아니다.
     */
    static String questionCore(String text) {
        if (text == null) {
            return null;
        }
        String flattened = Normalizer.normalize(text, Normalizer.Form.NFKC);
        int question = Math.max(flattened.lastIndexOf('?'), flattened.lastIndexOf('？'));
        if (question < 0) {
            return null;
        }
        String[] clauses = CLAUSE_BOUNDARY.split(flattened.substring(0, question));
        for (int index = clauses.length - 1; index >= 0; index--) {
            String core = normalize(clauses[index]);
            if (!core.isEmpty()) {
                return core;
            }
        }
        return null;
    }
}
