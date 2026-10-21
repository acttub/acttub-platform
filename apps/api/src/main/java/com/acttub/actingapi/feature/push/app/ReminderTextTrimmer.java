package com.acttub.actingapi.feature.push.app;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * 잠금 화면에 올라가는 글(노트의 다음 촬영 지시, 코치 질문)을 다듬는 순수 함수 모음.
 *
 * <p>잠금 화면은 남이 볼 수 있으므로 따옴표 안의 말(대사 인용), 대본의 대사 줄, 작품 제목, 인물 이름을 지운다.
 * 모델을 부르지 않고 규칙만으로 한다.
 */
public final class ReminderTextTrimmer {
    private ReminderTextTrimmer() {}

    /** 다음 촬영 지시를 쓸 수 없을 때 숙제 본문으로 쓴다. */
    public static final String FALLBACK_BODY = ReminderTemplates.HOMEWORK_FALLBACK_KO;
    public static final int NEXT_TAKE_MAX = 40;
    public static final int QUESTION_MAX = 30;
    static final int MIN_LENGTH = 10;
    static final int MIN_LINE_LENGTH = 6;
    static final double MIN_HANGUL_RATIO = 0.5;

    /** 지운 말 바로 뒤에 붙은 조사. 이름·인용을 지운 자리에 조사만 남지 않게 함께 지운다(공백·문장부호·글의 끝이 이어질 때만). */
    private static final String PARTICLE = "(?:에게서|에게|한테|께서|으로|이라고|라고|부터|까지|처럼|보다|은|는|이|가|을|를|과|와|의|도|만|로)(?=[\\s.,!?\u2026]|$)";
    private static final List<Pattern> QUOTED = List.of(
            quoted("\"[^\"]*\""), quoted("\u201C[^\u201D]*\u201D"), quoted("\u2018[^\u2019]*\u2019"),
            quoted("'[^']*'"), quoted("\u300C[^\u300D]*\u300D"), quoted("\u300E[^\u300F]*\u300F"));
    private static final Pattern STRAY_QUOTE = Pattern.compile("[\"\u201C\u201D\u2018\u2019'\u300C\u300D\u300E\u300F]");
    private static final Pattern EMPTY_BRACKETS = Pattern.compile("\\(\\s*\\)|\\[\\s*]|\\{\\s*}");
    private static final Pattern SPACES = Pattern.compile("\\s+");
    private static final Pattern SENTENCE_END = Pattern.compile("(?<=[.!?\u3002\uFF01\uFF1F\u2026])\\s+");
    private static final Pattern LEADING_JUNK = Pattern.compile("^[\\s,.;:\u00B7\\-\u2013\u2014/]+");
    private static final Pattern TRAILING_JUNK = Pattern.compile("[\\s,;:\u00B7\\-\u2013\u2014/]+$");

    /** 문장을 고르는 방식. 질문은 마지막 물음표 문장을 고른다. */
    public enum Pick { FIRST_SENTENCE, LAST_QUESTION }

    /**
     * 지워야 할 말의 목록을 만든다. 대사 줄은 6자 이상인 것만, 제목·이름은 2자 이상인 것만 담는다
     * (한두 글자를 지우면 멀쩡한 문장이 깨진다).
     */
    public static List<String> sensitiveTerms(Collection<String> titles, Collection<String> names, Collection<String> lines) {
        List<String> terms = new ArrayList<>();
        for (String title : orEmpty(titles)) addTerm(terms, title, 2);
        for (String name : orEmpty(names)) addTerm(terms, name, 2);
        for (String line : orEmpty(lines)) addTerm(terms, line, MIN_LINE_LENGTH);
        return terms;
    }

    private static Pattern quoted(String regex) { return Pattern.compile(regex + "(?:" + PARTICLE + ")?"); }

    private static Collection<String> orEmpty(Collection<String> values) { return values == null ? List.of() : values; }

    private static void addTerm(List<String> terms, String raw, int minLength) {
        if (raw == null) return;
        String normalized = SPACES.matcher(raw).replaceAll(" ").trim();
        if (normalized.codePointCount(0, normalized.length()) >= minLength) terms.add(normalized);
    }

    /** 숙제 본문: 노트의 다음 촬영 지시를 다듬은 글. 쓸 수 없으면 {@link #FALLBACK_BODY}(언어에 맞는 말). */
    public static String nextTake(String raw, Collection<String> sensitive, boolean korean) {
        return clean(raw, sensitive, NEXT_TAKE_MAX, Pick.FIRST_SENTENCE, korean)
                .orElse(korean ? ReminderTemplates.HOMEWORK_FALLBACK_KO : ReminderTemplates.HOMEWORK_FALLBACK_EN);
    }

    /** 이어 하기 본문에 넣을 코치 질문의 앞부분. 쓸 수 없으면 비어 있다. */
    public static Optional<String> question(String raw, Collection<String> sensitive, boolean korean) {
        return clean(raw, sensitive, QUESTION_MAX, Pick.LAST_QUESTION, korean);
    }

    /**
     * 다듬는 순서: 따옴표 안 지우기 → 대본 줄·제목·이름 지우기 → 공백 정리 → 문장 하나 고르기 →
     * (한국어 설정이면)한글 비율 검사 → 10자 미만 검사 → 길면 단어 경계에서 자르고 "…".
     *
     * @return 쓸 수 있는 글. 한글이 절반 미만이거나 10자 미만이면 비어 있다
     */
    public static Optional<String> clean(String raw, Collection<String> sensitive, int maxChars, Pick pick, boolean korean) {
        if (raw == null || raw.isBlank()) return Optional.empty();
        String text = raw;
        for (Pattern quoted : QUOTED) text = quoted.matcher(text).replaceAll(" ");
        text = STRAY_QUOTE.matcher(text).replaceAll(" ");
        text = SPACES.matcher(text).replaceAll(" ").trim();
        List<String> terms = new ArrayList<>(orEmpty(sensitive));
        terms.sort(Comparator.comparingInt(String::length).reversed());
        for (String term : terms) {
            if (term == null || term.isBlank()) continue;
            String normalized = SPACES.matcher(term).replaceAll(" ").trim();
            text = Pattern.compile(Pattern.quote(normalized) + "(?:" + PARTICLE + ")?").matcher(text).replaceAll(" ");
        }
        text = EMPTY_BRACKETS.matcher(text).replaceAll(" ");
        text = SPACES.matcher(text).replaceAll(" ").trim();
        text = LEADING_JUNK.matcher(text).replaceFirst("");
        if (text.isEmpty()) return Optional.empty();

        String sentence = pickSentence(text, pick);
        sentence = TRAILING_JUNK.matcher(LEADING_JUNK.matcher(sentence).replaceFirst("")).replaceFirst("");
        if (sentence.isEmpty()) return Optional.empty();
        if (korean && hangulRatio(sentence) < MIN_HANGUL_RATIO) return Optional.empty();
        if (sentence.codePointCount(0, sentence.length()) < MIN_LENGTH) return Optional.empty();
        return Optional.of(cut(sentence, maxChars));
    }

    private static String pickSentence(String text, Pick pick) {
        String[] sentences = SENTENCE_END.split(text);
        if (pick == Pick.FIRST_SENTENCE) return sentences[0].trim();
        for (int i = sentences.length - 1; i >= 0; i--) {
            String s = sentences[i].trim();
            if (s.endsWith("?") || s.endsWith("\uFF1F")) return s;
        }
        return sentences[sentences.length - 1].trim();
    }

    /** 글자(문자) 가운데 한글 음절·자모의 비율. 숫자·기호·공백은 세지 않는다. 글자가 없으면 0. */
    static double hangulRatio(String text) {
        int letters = 0;
        int hangul = 0;
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            i += Character.charCount(cp);
            if (!Character.isLetter(cp)) continue;
            letters++;
            Character.UnicodeScript script = Character.UnicodeScript.of(cp);
            if (script == Character.UnicodeScript.HANGUL) hangul++;
        }
        return letters == 0 ? 0 : (double) hangul / letters;
    }

    /** maxChars 를 넘으면 단어 경계(공백)에서 자르고 "…" 를 붙인다. 경계가 너무 앞이면 글자 수에서 자른다. */
    static String cut(String text, int maxChars) {
        if (text.codePointCount(0, text.length()) <= maxChars) return text;
        int end = text.offsetByCodePoints(0, maxChars);
        String head = text.substring(0, end);
        int space = head.lastIndexOf(' ');
        if (space >= maxChars / 2) head = head.substring(0, space);
        head = TRAILING_JUNK.matcher(head).replaceFirst("");
        return head + "\u2026";
    }
}
