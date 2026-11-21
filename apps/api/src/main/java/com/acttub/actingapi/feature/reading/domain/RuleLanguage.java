package com.acttub.actingapi.feature.reading.domain;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 줄의 말을 글자 종류로 정한다(풀규칙, SOMA-1090). 모델에 묻던 「줄별 말」({@link LineLanguage}, SOMA-751)의 규칙판이다 — 풀규칙은 모델을
 * 부르지 않으니 외국어 줄이 한국어 목소리로 읽히지 않게 이것으로 채운다.
 *
 * <p>한글이 아닌 글자가 {@link LineLanguage#worthAsking} 만큼 있는 대사 줄만 본다. 한글이 외국 글자의 두 배 이상이면 한국어 줄로 두고(「오늘 CEO
 * 회의」 — 받아쓰기가 한국어로 듣게), 아니면 가나 → ja, 키릴 → ru, 아랍 → ar, 그리스 → el, 데바나가리 → hi, 라틴은 악센트 글자와 흔한 낱말로
 * en·fr·es·de·it·pt 를 가른다(모르면 en). 한자만 있는 줄(중국어)은 앱 목소리가 읽지 못해 두지 않는다. 한글과 섞인 줄은 글자 종류가 바뀌는
 * 자리에서 조각을 나눠 {@code ⟦ko⟧…⟦en⟧…} 으로 소리 낼 글을 만든다. 괄호 지시는 소리 낼 글에서 빼고, 대문자 줄임말(「HIV」)은 외국 글자로
 * 세지 않는다(한국어 목소리가 읽는다).
 */
public final class RuleLanguage {
    private static final Map<String, Set<String>> WORDS = Map.of(
            "en", Set.of("the", "you", "i", "a", "is", "are", "and", "to", "of", "what", "it", "me", "my", "no", "yes", "this", "that", "do",
                    "don't", "not", "in", "on", "for", "with", "we", "he", "she", "they", "was", "be", "have", "your", "so", "oh", "hey",
                    "please", "thank", "thanks", "sorry", "why", "how", "who", "where", "love", "know", "just", "can", "will", "never", "all",
                    "here", "there", "now", "good", "right", "come", "go", "get", "let's", "i'm", "it's", "left", "much"),
            "fr", Set.of("le", "la", "les", "je", "tu", "vous", "est", "et", "pas", "de", "du", "une", "un", "oui", "non", "merci", "bonjour",
                    "mon", "ma", "mes", "ce", "c'est", "qui", "que", "suis", "très", "moi", "toi", "nous", "avec", "pour", "dans", "beaucoup"),
            "es", Set.of("el", "la", "los", "las", "que", "de", "y", "es", "no", "sí", "por", "gracias", "hola", "señor", "qué", "cómo", "yo",
                    "tú", "usted", "muy", "bien", "está", "estoy", "para", "con", "una", "un", "mi"),
            "de", Set.of("der", "die", "das", "ich", "du", "nicht", "und", "ist", "ja", "nein", "danke", "bitte", "mein", "dein", "wir", "sie",
                    "er", "es", "ein", "eine", "mit", "was", "wie"),
            "it", Set.of("il", "che", "non", "sono", "grazie", "ciao", "sì", "io", "tu", "lui", "lei", "noi", "è", "un", "una", "per", "con",
                    "mio"),
            "pt", Set.of("o", "a", "os", "as", "que", "de", "e", "é", "não", "sim", "obrigado", "obrigada", "você", "eu", "um", "uma", "para",
                    "com", "meu"));
    private static final List<String> LATIN_ORDER = List.of("en", "fr", "es", "de", "it", "pt");
    /** 괄호 지시 — 소리 낼 글에서 뺀다. */
    private static final java.util.regex.Pattern DIRECTION = java.util.regex.Pattern.compile("\\([^)]*+\\)|（[^）]*+）|\\[[^]]*+]");
    /** 대문자 줄임말(「HIV」「NPO」「CEO」) — 한국어 목소리가 읽으니 외국 글자로 세지 않는다. */
    private static final java.util.regex.Pattern ACRONYM = java.util.regex.Pattern.compile("(?<![A-Za-z])[A-Z]{2,5}+(?![A-Za-z])");

    private RuleLanguage() {
    }

    /** 대본의 대사 줄마다 말을 붙인다. 한국어 줄·판단 못 한 줄은 그대로(비워) 둔다. */
    public static ScriptDraft tag(ScriptDraft draft) {
        Map<Integer, LineLanguage.Result> found = new HashMap<>();
        for (ScriptDraft.Line line : draft.lines()) {
            if (!"dialogue".equals(line.kind())) continue;
            LineLanguage.Result result = of(line.text());
            if (result != null) found.put(line.ordinal(), result);
        }
        return draft.withLanguages(found);
    }

    /** 한 줄의 말. 한국어 줄이거나 판단하지 못하면 null. */
    public static LineLanguage.Result of(String text) {
        if (!LineLanguage.worthAsking(text)) return null;
        String spoken = DIRECTION.matcher(text).replaceAll(" ").replaceAll("[^\\S\\n]{2,}+", " ").strip();
        String body = ACRONYM.matcher(spoken).replaceAll(" ");
        int hangul = 0;
        int foreign = 0;
        Map<Character.UnicodeScript, Integer> scripts = new HashMap<>();
        for (int i = 0; i < body.length(); ) {
            int c = body.codePointAt(i);
            i += Character.charCount(c);
            if (!Character.isLetter(c)) continue;
            Character.UnicodeScript script = Character.UnicodeScript.of(c);
            if (script == Character.UnicodeScript.HANGUL) {
                hangul++;
            } else {
                foreign++;
                scripts.merge(script, 1, Integer::sum);
            }
        }
        if (foreign < LineLanguage.FOREIGN_LETTERS || hangul >= foreign * 2) return null;
        String lang = foreignLang(scripts, body);
        if (lang == null || !LineLanguage.SUPPORTED.contains(lang)) return null;
        if (hangul == 0) return new LineLanguage.Result(lang, spoken.equals(text) ? null : spoken);
        return new LineLanguage.Result(lang, segments(spoken, lang));
    }

    private static String foreignLang(Map<Character.UnicodeScript, Integer> scripts, String body) {
        if (scripts.containsKey(Character.UnicodeScript.HIRAGANA) || scripts.containsKey(Character.UnicodeScript.KATAKANA)) return "ja";
        if (scripts.containsKey(Character.UnicodeScript.CYRILLIC)) return "ru";
        if (scripts.containsKey(Character.UnicodeScript.ARABIC)) return "ar";
        if (scripts.containsKey(Character.UnicodeScript.GREEK)) return "el";
        if (scripts.containsKey(Character.UnicodeScript.DEVANAGARI)) return "hi";
        if (scripts.containsKey(Character.UnicodeScript.LATIN)) return latinLang(body);
        return null;
    }

    /** 라틴 글자 줄의 말 — 악센트 글자가 먼저, 다음은 흔한 낱말 수. 모르면 영어. */
    private static String latinLang(String body) {
        String lower = body.toLowerCase(Locale.ROOT);
        if (hasAny(lower, "ñ¿¡")) return "es";
        if (hasAny(lower, "ßäöü")) return "de";
        if (hasAny(lower, "ãõ")) return "pt";
        Map<String, Integer> score = new HashMap<>();
        for (String word : lower.split("[^\\p{L}']+")) {
            if (word.isEmpty()) continue;
            for (String lang : LATIN_ORDER) {
                if (WORDS.get(lang).contains(word)) score.merge(lang, 1, Integer::sum);
            }
        }
        if (hasAny(lower, "çàâêèëîïôœû")) score.merge("fr", 2, Integer::sum);
        if (hasAny(lower, "ìò")) score.merge("it", 2, Integer::sum);
        String best = "en";
        int bestScore = score.getOrDefault("en", 0);
        for (String lang : LATIN_ORDER) {
            int s = score.getOrDefault(lang, 0);
            if (s > bestScore) {
                best = lang;
                bestScore = s;
            }
        }
        return best;
    }

    private static boolean hasAny(String text, String letters) {
        for (int i = 0; i < letters.length(); i++) {
            if (text.indexOf(letters.charAt(i)) >= 0) return true;
        }
        return false;
    }

    /** 한글과 외국 글자가 바뀌는 자리에서 조각을 나눈다. 글자가 아닌 것(공백·부호·숫자)은 앞 조각에 붙는다. */
    private static String segments(String text, String lang) {
        StringBuilder out = new StringBuilder();
        String current = null;
        StringBuilder run = new StringBuilder();
        boolean[] acronym = new boolean[text.length()];
        java.util.regex.Matcher m = ACRONYM.matcher(text);
        while (m.find()) java.util.Arrays.fill(acronym, m.start(), m.end(), true);
        for (int i = 0; i < text.length(); ) {
            int at = i;
            int c = text.codePointAt(i);
            i += Character.charCount(c);
            // 줄임말은 앞 조각에 붙인다(한국어 문장 속 「HIV면」)
            String kind = !Character.isLetter(c) || acronym[at] ? null
                    : Character.UnicodeScript.of(c) == Character.UnicodeScript.HANGUL ? LineLanguage.KOREAN : lang;
            if (kind != null && current != null && !kind.equals(current)) {
                out.append(LineLanguage.MARK_OPEN).append(current).append(LineLanguage.MARK_CLOSE).append(run);
                run.setLength(0);
            }
            if (kind != null) current = kind;
            run.appendCodePoint(c);
        }
        if (current != null) out.append(LineLanguage.MARK_OPEN).append(current).append(LineLanguage.MARK_CLOSE).append(run);
        return out.toString().strip();
    }
}
