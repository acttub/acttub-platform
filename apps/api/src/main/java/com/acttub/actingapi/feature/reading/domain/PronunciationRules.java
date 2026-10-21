package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 리딩 발음 보고서 규칙(SOMA-606, 실험) — 줄마다 받은 채점 결과(apps/pron)와 받아쓴 글로 보고서를 만든다.
 *
 * <p>보고서는 세 부분이다(10/21 시안 v4 — 소리 목록이 아니라 전달 중심):
 * <ol>
 *   <li>전체 진단 — 대본대로 읽은 줄에서 또렷하게 들린 소리의 비율.</li>
 *   <li>다르게 알아들을 수 있는 말 — 대본대로 읽은 줄인데 받아쓰기가 다른 말로 적은 어절.</li>
 *   <li>자주 보인 습관 하나 — 같은 소리가 같은 소리로 바뀐 것(예: ㅓ→ㅗ)이 {@link #HABIT_MAX_LPR} 이하로 2번 이상일 때만.
 *       표시 분류는 그 소리의 자리(자음 첫소리·받침·모음)다.</li>
 * </ol>
 *
 * <p>빼는 것: 받아쓴 글이 없거나 대본과 자모 유사도가 {@link #MIN_LINE_SIMILARITY} 보다 낮은 줄(대사를 바꿔 말했거나
 * 건너뜀 — 발음 문제로 잡으면 안 된다), 감탄사, 숫자가 든 어절(읽는 법이 갈린다), 말끝 '-고요'의 ㅗ→ㅜ(구어 '-구요').
 * 한 어절에서는 lpr 이 가장 낮은 소리 하나만 센다. 정확도는 검증되지 않았다 — 표시 문구가 단정하지 않게 한다.
 */
public final class PronunciationRules {
    public static final double MIN_LINE_SIMILARITY = 0.8;
    /** 받아쓴 어절이 대본 어절과 이보다 덜 닮았으면 '다르게 알아들을 수 있는 말'이다. */
    public static final double MISHEARD_SIMILARITY = 0.8;
    public static final int MAX_MISHEARD = 3;
    public static final int MIN_HABIT_COUNT = 2;
    /**
     * 습관으로 셀 만큼 확실히 다른 소리. 표준 발음 낭독 77줄로 6줄 리딩을 2,000번 뽑아 보니, 짚힌 소리를 자리(첫소리·받침·모음)로만
     * 묶으면 79~91% 리딩에서 가짜 습관이 나왔고, 같은 소리 쌍 + 이 문턱이면 약 4% 였다.
     */
    public static final double HABIT_MAX_LPR = -5.0;
    /**
     * 앱 받아쓰기로는 대본과 달라 보여도(잘림·숫자 표기) 채점 모델이 들은 소리가 대본과 이만큼 같으면 대본대로 읽은 줄로
     * 쓴다. 표준 발음 낭독(합성 음성·Zeroth 공개 낭독)과 반만 읽은·다른 줄을 읽은 경우로 정했다 — PR 본문 참고.
     */
    public static final double MIN_SCRIPT_MATCH = 0.7;
    private static final Set<String> INTERJECTIONS = Set.of(
            "아", "어", "오", "음", "으", "흠", "하", "허", "에", "예", "네", "응", "와", "헐", "아니", "어머", "엥", "쩝", "휴", "후");

    private PronunciationRules() {
    }

    public record Phone(String expected, String heard, double lpr, boolean vowel, Integer syllable,
            Integer startMs, Integer endMs, boolean flagged) {
    }

    public record Word(int index, String word, boolean number, List<Phone> phones) {
    }

    /**
     * @param scriptMatch 채점 모델이 녹음에서 직접 알아들은 소리가 대본 소리와 얼마나 같은지(0~1). 앱 받아쓰기가 잘렸을 때
     *                    대본대로 읽었는지를 이것으로 다시 본다. 옛 채점 서비스는 주지 않는다({@code null}).
     */
    public record ScoredLine(String scoredText, List<Word> words, Double scriptMatch) {
        public ScoredLine(String scoredText, List<Word> words) {
            this(scoredText, words, null);
        }
    }

    /** @param transcript 앱이 받아쓴 글. 없으면 {@code null} */
    public record LineInput(int lineNo, String scriptText, String transcript, ScoredLine scored) {
    }

    public enum Habit {
        ONSET("자음 첫소리가 흐려요"), CODA("받침 소리가 흐려요"), VOWEL("모음이 다르게 들려요");

        private final String label;

        Habit(String label) {
            this.label = label;
        }

        public String label() {
            return label;
        }
    }

    public record Summary(int sounds, int clearSounds, double clearRatio, int linesUsed, int linesSkipped) {
    }

    public record Misheard(int lineNo, String word, String heard, Integer startMs, Integer endMs) {
    }

    public record Example(int lineNo, String word, String expected, String heard, double lpr, Integer startMs, Integer endMs) {
    }

    public record HabitItem(Habit habit, String label, int count, List<Example> examples) {
    }

    public record Report(Summary summary, List<Misheard> misheard, HabitItem habit, List<Integer> skippedLines) {
        /** 쓸 수 있는 줄이 하나도 없으면 보고서를 내지 않는다(skipped). */
        public boolean empty() {
            return summary.linesUsed() == 0;
        }
    }

    public static Report build(List<LineInput> lines) {
        int sounds = 0;
        int clear = 0;
        List<Integer> skipped = new ArrayList<>();
        List<Misheard> misheard = new ArrayList<>();
        Map<String, List<Example>> habits = new LinkedHashMap<>();
        Map<String, Habit> habitKinds = new LinkedHashMap<>();
        int used = 0;
        for (LineInput line : lines) {
            Use use = line.scored() == null ? Use.NO : use(line);
            if (use == Use.NO) {
                skipped.add(line.lineNo());
                continue;
            }
            used += 1;
            for (Word word : line.scored().words()) {
                if (excluded(word)) {
                    continue;
                }
                Phone worst = null;
                for (Phone phone : word.phones()) {
                    sounds += 1;
                    boolean counts = phone.flagged() && !informalGoyo(word, phone);
                    if (!counts) {
                        clear += 1;
                    } else if (worst == null || phone.lpr() < worst.lpr()) {
                        worst = phone;
                    }
                }
                if (worst != null && worst.lpr() <= HABIT_MAX_LPR) {
                    String pair = worst.expected() + "→" + worst.heard();
                    habitKinds.putIfAbsent(pair, habitOf(word, worst));
                    habits.computeIfAbsent(pair, h -> new ArrayList<>()).add(new Example(
                            line.lineNo(), clean(word.word()), worst.expected(), worst.heard(), worst.lpr(),
                            wordStart(word), wordEnd(word)));
                }
            }
            if (use == Use.TRANSCRIPT) {
                // 받아쓰기가 잘린 줄은 받아쓰기와 대본의 차이가 발음 때문이 아니다.
                misheard.addAll(misheard(line));
            }
        }
        HabitItem habit = habits.entrySet().stream()
                .filter(e -> e.getValue().size() >= MIN_HABIT_COUNT)
                .max(Comparator.comparingInt(e -> e.getValue().size()))
                .map(e -> new HabitItem(habitKinds.get(e.getKey()), habitKinds.get(e.getKey()).label(), e.getValue().size(),
                        e.getValue().stream().sorted(Comparator.comparingDouble(Example::lpr)).limit(3).toList()))
                .orElse(null);
        double ratio = sounds == 0 ? 0 : Math.round(clear * 1000.0 / sounds) / 1000.0;
        return new Report(new Summary(sounds, clear, ratio, used, skipped.size()),
                misheard.stream().limit(MAX_MISHEARD).toList(), habit, skipped);
    }

    /** 줄을 쓰는 근거. {@code TRANSCRIPT}: 받아쓰기가 대본과 닮음. {@code AUDIO}: 받아쓰기는 다르지만 들은 소리가 대본과 같음. */
    enum Use { NO, TRANSCRIPT, AUDIO }

    static boolean usable(LineInput line) {
        return use(line) != Use.NO;
    }

    static Use use(LineInput line) {
        String heard = line.transcript() == null ? "" : clean(line.transcript());
        if (heard.isEmpty()) {
            return Use.NO;
        }
        String script = clean(line.scored().scoredText() != null ? line.scored().scoredText() : line.scriptText());
        for (String reading : KoreanNumbers.readings(line.transcript())) {
            if (similarity(script, clean(reading)) >= MIN_LINE_SIMILARITY) {
                return Use.TRANSCRIPT;
            }
        }
        Double match = line.scored().scriptMatch();
        return match != null && match >= MIN_SCRIPT_MATCH ? Use.AUDIO : Use.NO;
    }

    static boolean excluded(Word word) {
        String w = clean(word.word());
        return word.number() || w.isEmpty() || INTERJECTIONS.contains(w);
    }

    /** '있고요'의 ㅗ→ㅜ 처럼 말끝 '-고요'를 '-구요'로 말한 것은 일상 말투다. */
    static boolean informalGoyo(Word word, Phone phone) {
        return clean(word.word()).endsWith("고요") && "ㅗ".equals(phone.expected()) && "ㅜ".equals(phone.heard());
    }

    /** 음절 안에서 모음 앞의 자음은 첫소리, 뒤의 자음은 받침이다. */
    static Habit habitOf(Word word, Phone target) {
        if (target.vowel()) {
            return Habit.VOWEL;
        }
        List<Phone> phones = word.phones();
        int at = phones.indexOf(target);
        for (int i = at + 1; i < phones.size(); i += 1) {
            Phone next = phones.get(i);
            if (!java.util.Objects.equals(next.syllable(), target.syllable())) {
                break;
            }
            if (next.vowel()) {
                return Habit.ONSET;
            }
        }
        return Habit.CODA;
    }

    /** 대본 어절과 받아쓴 어절을 편집 거리로 맞추고, 바뀐 자리 중 덜 닮은 것을 고른다. */
    /** 받아쓰기의 숫자 읽기(원문·한자어·고유어) 가운데 대본과 가장 닮은 것. "29이야"를 "스물아홉이야"로 맞춘다. */
    static String closestReading(LineInput line) {
        String script = clean(line.scored().scoredText() != null ? line.scored().scoredText() : line.scriptText());
        String best = line.transcript();
        double bestSimilarity = -1;
        for (String reading : KoreanNumbers.readings(line.transcript())) {
            double sim = similarity(script, clean(reading));
            if (sim > bestSimilarity) {
                best = reading;
                bestSimilarity = sim;
            }
        }
        return best;
    }

    static List<Misheard> misheard(LineInput line) {
        List<Word> words = line.scored().words().stream().filter(w -> !excluded(w)).toList();
        String[] heard = closestReading(line).trim().split("\\s+");
        int n = words.size();
        int m = heard.length;
        double[][] d = new double[n + 1][m + 1];
        for (int i = 0; i <= n; i += 1) {
            d[i][0] = i;
        }
        for (int j = 0; j <= m; j += 1) {
            d[0][j] = j;
        }
        for (int i = 1; i <= n; i += 1) {
            for (int j = 1; j <= m; j += 1) {
                double sub = 1 - similarity(clean(words.get(i - 1).word()), clean(heard[j - 1]));
                d[i][j] = Math.min(d[i - 1][j - 1] + sub, Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1));
            }
        }
        List<Misheard> out = new ArrayList<>();
        int i = n;
        int j = m;
        while (i > 0 && j > 0) {
            double sim = similarity(clean(words.get(i - 1).word()), clean(heard[j - 1]));
            if (Math.abs(d[i][j] - (d[i - 1][j - 1] + 1 - sim)) < 1e-9) {
                Word w = words.get(i - 1);
                String h = clean(heard[j - 1]);
                if (sim < MISHEARD_SIMILARITY && sim > 0 && !h.isEmpty()) {
                    out.add(0, new Misheard(line.lineNo(), clean(w.word()), h, wordStart(w), wordEnd(w)));
                }
                i -= 1;
                j -= 1;
            } else if (Math.abs(d[i][j] - (d[i - 1][j] + 1)) < 1e-9) {
                i -= 1;
            } else {
                j -= 1;
            }
        }
        return out;
    }

    static Integer wordStart(Word word) {
        return word.phones().stream().map(Phone::startMs).filter(java.util.Objects::nonNull).min(Integer::compare).orElse(null);
    }

    static Integer wordEnd(Word word) {
        return word.phones().stream().map(Phone::endMs).filter(java.util.Objects::nonNull).max(Integer::compare).orElse(null);
    }

    static String clean(String s) {
        return s == null ? "" : s.replaceAll("[^가-힣A-Za-z0-9]", "");
    }

    /** 자모로 풀어 편집 거리로 잰 유사도(0~1). */
    public static double similarity(String a, String b) {
        String x = jamo(a);
        String y = jamo(b);
        int max = Math.max(x.length(), y.length());
        if (max == 0) {
            return 1;
        }
        int[] prev = new int[y.length() + 1];
        int[] cur = new int[y.length() + 1];
        for (int j = 0; j <= y.length(); j += 1) {
            prev[j] = j;
        }
        for (int i = 1; i <= x.length(); i += 1) {
            cur[0] = i;
            for (int j = 1; j <= y.length(); j += 1) {
                int cost = x.charAt(i - 1) == y.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(prev[j - 1] + cost, Math.min(prev[j] + 1, cur[j - 1] + 1));
            }
            int[] t = prev;
            prev = cur;
            cur = t;
        }
        return 1 - (double) prev[y.length()] / max;
    }

    static String jamo(String s) {
        StringBuilder out = new StringBuilder();
        for (char c : s.toCharArray()) {
            int code = c - 0xAC00;
            if (code < 0 || code > 11171) {
                out.append(c);
                continue;
            }
            out.append((char) (0x1100 + code / 588)).append((char) (0x1161 + (code % 588) / 28));
            if (code % 28 != 0) {
                out.append((char) (0x11A7 + code % 28));
            }
        }
        return out.toString();
    }
}
