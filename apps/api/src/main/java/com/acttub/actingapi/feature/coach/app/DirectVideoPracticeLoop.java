package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.platform.web.OutputLanguage;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 연습 루프 프롬프트({@code practice-loop.txt})의 숨은 칸을 다룬다.
 *
 * <p>모델은 첫 응답에 {@code <설계>}와 {@code <코치>}를, 이후 응답마다 맨 앞에 {@code <상태>} 한 줄을 쓴다.
 * 배우에게는 코치 본문만 저장하고 보여준다. 숨은 칸은 {@code coaching_state.practice_loop}에 두었다가
 * 다음 턴에 모델에 넘기는 대화 기록에만 다시 붙인다 — 모델은 자기 설계와 직전 상태를 보고 다음 단계를 고른다.
 */
final class DirectVideoPracticeLoop {
    static final String STATE_KEY = "practice_loop";
    private static final Pattern DESIGN = Pattern.compile("(?s)<설계>\\s*(.*?)\\s*</설계>");
    private static final Pattern STATUS = Pattern.compile("(?s)<상태>\\s*(.*?)\\s*</상태>");
    private static final Pattern COACH = Pattern.compile("(?s)<코치>\\s*(.*?)\\s*(?:</코치>|$)");
    // 숨은 메모 태그 이름. 모델이 <생각> 대신 영어 <thought>·<think>로 쓰는 일이 있다(2026-10-11 00:59 운영, 배우 화면에 "<thought>"가 나갔다).
    private static final String THINKING_NAME = "(?:생각|thought|think|thinking)";
    private static final Pattern STRAY_TAG = Pattern.compile("(?i)</?(?:설계|상태|코치|다음 테이크|보기|카드|인물 카드|장면|" + THINKING_NAME + ")>");
    /** 목적별 코칭(SOMA-719)의 숨은 칸. 서버가 응답의 버튼·결과 카드·인물 카드·장면으로 따로 내보내고 코치 말에서는 뗀다. 닫지 않았으면 끝까지 칸이다. */
    static final Pattern PURPOSE_BLOCK = Pattern.compile("(?s)<(보기|카드|인물 카드|장면)>.*?(?:</\\1>|$)");
    // 둘째 응답부터 코치가 말하기 전에 적는 숨은 메모. 배우 화면·저장 대화에 넣지 않는다.
    private static final Pattern THINKING = Pattern.compile("(?is)<(" + THINKING_NAME + ")>.*?</\\1>");
    private static final Pattern THINKING_OPEN = Pattern.compile("(?i)<" + THINKING_NAME + ">");
    private static final Pattern THINKING_CLOSE = Pattern.compile("(?i)</" + THINKING_NAME + ">");
    /**
     * 꺾쇠를 닫지 않은 메모 태그만 있는 줄("<thought" 다음 줄바꿈). 그 아래가 배우에게 할 말이었다.
     * 2026-10-14~10-22 운영에서 8번, 배우 화면 맨 앞에 "<thought"가 그대로 나갔다(닫는 꺾쇠가 없어 위 태그 패턴에 안 걸렸다).
     */
    static final Pattern UNCLOSED_THINKING_LINE = Pattern.compile(
            "(?imu)^[ \\t]*</?" + THINKING_NAME + "(?![\\p{L}\\p{N}_>-])[^>\\n]*$\\R?");
    // 닫는 태그를 빠뜨렸을 때 메모의 칸 줄만 걷어낸다.
    private static final Pattern THINKING_LINE = Pattern.compile(
            "(?im)^\\s*(?:<" + THINKING_NAME + ">\\s*$|(?:배우가 한 말|배우가 지금 원하는 것|이번 목표|내 대답|끝 질문|글자 수)\\s*:.*$)\\R?");
    // 마무리2 에서 모델이 건넨 행동을 노트에 남기려고 쓰게 하는 숨은 줄. 배우에게는 보이지 않는다.
    private static final Pattern NEXT_TAKE_TAG = Pattern.compile("(?s)<다음 테이크>\\s*(.*?)\\s*</다음 테이크>");
    /** 닫는 꺾쇠가 빠진 숨은 줄 끝("</다음 테이크"). 2026-10-21 재생: 정리 말에 "~좋아요.</다음 테이크"가 그대로 보였다. */
    private static final Pattern NEXT_TAKE_OPEN_CLOSE = Pattern.compile("</다음 테이크(?!>)");

    private static String closedNextTake(String text) {
        return NEXT_TAKE_OPEN_CLOSE.matcher(text).replaceAll("</다음 테이크>");
    }
    // 모델이 줄 끝에 남기는 날 자모("알려 주세요.ㄴ" 같은). 실험에서 실제로 나왔고 다음 턴에 그대로 따라 한다.
    private static final Pattern TRAILING_JAMO = Pattern.compile("(?m)(?<=[^\\s\\u3131-\\u318E])[\\u3131-\\u318E]+[ \\t]*$");

    private DirectVideoPracticeLoop() { }

    /** 모델 응답 하나를 숨은 칸과 배우에게 보일 본문으로 나눈 것. 없는 칸은 빈 문자열이다. */
    record Parsed(String design, String status, String message) { }

    /** 첫 응답에서 물음표로 끝나는 마지막 줄만 남긴다. 그런 줄이 없으면 그대로 둔다. */
    static String onlyFirstQuestion(String message) {
        var lines = message.strip().lines().map(String::strip).filter(line -> !line.isEmpty()).toList();
        if (lines.size() <= 1) return message.strip();
        String last = lines.get(lines.size() - 1);
        return last.endsWith("?") ? last : message.strip();
    }

    private static final Pattern AGREEMENT = Pattern.compile("^\\s*맞아요[,.!]?\\s*(?:그거예요[.!]?\\s*)?");

    /** 맨 앞의 "맞아요, 그거예요." 같은 인정 말을 뗀다. 뗀 뒤 비면 그대로 둔다. */
    static String withoutAgreement(String message) {
        String rest = AGREEMENT.matcher(message).replaceFirst("").strip();
        return rest.isEmpty() ? message.strip() : rest;
    }

    static Parsed parse(String raw) {
        String text = raw == null ? "" : closedNextTake(raw.strip());
        String design = first(DESIGN, text);
        String status = first(STATUS, text);
        String rest = NEXT_TAKE_TAG.matcher(STATUS.matcher(DESIGN.matcher(text).replaceAll("")).replaceAll("")).replaceAll("");
        rest = THINKING.matcher(rest).replaceAll("");
        rest = PURPOSE_BLOCK.matcher(rest).replaceAll("");
        // 여는 태그 없이 </생각>만 남았으면 그 앞은 모두 메모다(실험에서 실제로 나왔다).
        Matcher close = THINKING_CLOSE.matcher(rest);
        int strayClose = -1;
        while (close.find()) strayClose = close.end();
        if (strayClose >= 0) rest = rest.substring(strayClose);
        if (THINKING_OPEN.matcher(rest).find()) rest = THINKING_LINE.matcher(rest).replaceAll("");
        rest = UNCLOSED_THINKING_LINE.matcher(rest).replaceAll("");
        Matcher coach = COACH.matcher(rest);
        String message = coach.find() ? coach.group(1) : rest;
        message = STRAY_TAG.matcher(message).replaceAll("");
        return new Parsed(design, status, TRAILING_JAMO.matcher(message).replaceAll("").strip());
    }

    // 영상 시간으로 구간을 가리키는 말("0:23", "0:03부터 0:46까지", "3초에"). 배우는 시간을 보고 장면을 떠올리지 못한다.
    private static final String CLOCK = "(?<![\\d:])\\d{1,2}:\\d{2}(?::\\d{2})?(?![\\d:])";
    private static final Pattern TIMESTAMP = Pattern.compile(CLOCK
            + "|\\d+(?:\\.\\d+)?\\s*초\\s*(?:부터|에서|쯤에|께|경에|에)|(?i:\\b\\d+\\s*seconds?\\s+in\\b)");
    private static final List<Pattern> TIMESTAMP_PARTS = List.of(
            Pattern.compile("\\s*[(\\[]\\s*" + CLOCK + "(?:\\s*[~\\-–]\\s*" + CLOCK + ")?\\s*[)\\]]"),
            Pattern.compile(CLOCK + "\\s*(?:부터|~|-|–)\\s*" + CLOCK + "\\s*(?:까지)?\\s*(?:의|에서도|에서|에도|에)?\\s*"),
            Pattern.compile("(?i:(?:from\\s+)?" + CLOCK + "\\s*(?:to|-|–)\\s*" + CLOCK + "\\s*)"),
            Pattern.compile("(?i:(?:at|around)\\s+)" + CLOCK + "\\s*"),
            Pattern.compile(CLOCK + "\\s*(?:쯤|경)?\\s*(?:의|에서도|에서|에도|에)?\\s*"));

    /** 코치 말이 길다고 보는 글자 수(공백 포함). 목표는 50자 안쪽이고 이보다 길면 줄이기 호출을 한다. */
    static final int LONG_REPLY = 60;
    /** 배우가 이유·방법·예시·설명·피드백을 달라고 했을 때의 길이. 이때는 50자에 맞추려고 답을 줄이지 않는다. */
    static final int EXPLAIN_REPLY = 120;

    /** 화면에 보이는 글자 수. 줄바꿈과 이어진 공백은 한 칸으로 센다. */
    static int displayLength(String text) {
        if (text == null) return 0;
        String flat = text.strip().replaceAll("\\s+", " ");
        return flat.codePointCount(0, flat.length());
    }

    /** 배우에게 보일 말에 영상 시간 표기가 있는지. */
    static boolean hasTimestamp(String text) {
        return text != null && TIMESTAMP.matcher(text).find();
    }

    /** 다시 써도 시간이 남았을 때의 마지막 정리. 시간 부분만 걷어낸다. */
    static String stripTimestamps(String text) {
        String value = text;
        for (Pattern part : TIMESTAMP_PARTS) value = part.matcher(value).replaceAll("");
        return value.replaceAll("[ \\t]{2,}", " ").replaceAll("(?m)^[ \\t]+", "").strip();
    }

    /** 배우에게 보일 말이 빈 응답을 한 번 다시 쓰게 할 때 지시 끝에 붙이는 말. */
    // 모델이 생각을 다 쓰고 한도에 걸리면 대화와 상관없는 웹페이지·코드·자모를 뱉는다(2026-10-09 운영 3건).
    private static final Pattern MARKUP_OR_CODE = Pattern.compile(
            "(?i)<!DOCTYPE|</?(?:html|head|body|div|article|footer|section|span|script|style|meta|table)\\b|\\busing System\\b"
                    + "|\\bnamespace\\s+\\w|\\bpublic\\s+(?:class|static|void)\\b|```|\\{\\s*\"[a-z_]+\"\\s*:");

    private static final Pattern LEFTOVER_TAG = Pattern.compile("</?[A-Za-z][A-Za-z0-9_-]*\\s*/?>");
    // 글머리에 남은 한글 이름 태그(<추가> 같은). 영상 없는 내려놓기 답에서 나왔다(2026-10-21). 대본 지문(<웃음>)을 말 중간에 인용할 수 있어 맨 앞에 있을 때만 본다.
    private static final Pattern LEADING_TAG = Pattern.compile("^\\s*</?\\p{L}[\\p{L}\\p{N}_-]*\\s*/?>");

    /**
     * 배우에게 보낼 수 없는 출력인지. HTML·코드가 섞였거나, 한국어 대화에서 한글이 글자의 절반이 안 되거나,
     * 날 자모가 반복되면 깨진 출력으로 본다. 빈 말은 여기서 보지 않는다(빈 답 다시 쓰기가 따로 있다).
     */
    static boolean looksBroken(String text, java.util.Locale language) {
        if (text == null || text.isBlank()) return false;
        // 제로폭 공백(U+200B) 같은 보이지 않는 글자만 있으면 isBlank()를 통과해 빈 말풍선이 나간다(10/9 22:46 운영).
        if (text.replaceAll("[\\p{Cf}\\s]+", "").isEmpty()) return true;
        if (MARKUP_OR_CODE.matcher(text).find()) return true;
        // 숨은 칸을 걷어낸 뒤에도 꺾쇠 태그(<thought>, <answer> 같은)가 남았으면 배우에게 보내지 않는다.
        if (LEFTOVER_TAG.matcher(text).find() || LEADING_TAG.matcher(text).find()) return true;
        boolean korean = language == null || "ko".equals(language.getLanguage());
        if (!korean) return false;
        int hangul = 0, jamo = 0, letters = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c >= '\uAC00' && c <= '\uD7A3') { hangul++; letters++; }
            else if (c >= '\u3131' && c <= '\u318E') { jamo++; letters++; }
            else if (Character.isLetter(c)) letters++;
        }
        return letters > 0 && (hangul * 2 < letters || jamo >= 6);
    }

    /**
     * 스트리밍 도중 아직 다 쓰지 않은 보일 글이 이미 깨졌는지. 앞부분만으로도 확실한 신호(날 자모 6자 이상, HTML·코드)만 본다.
     * 한글 비율은 영어 대사 인용으로 시작하는 정상 답("\"Who knows\"에서…")을 앞부분에서 잘못 잡으므로 다 쓴 뒤 {@link #looksBroken} 에서만 본다.
     */
    static boolean looksBrokenSoFar(String text, java.util.Locale language) {
        if (text == null || text.isBlank()) return false;
        if (MARKUP_OR_CODE.matcher(text).find()) return true;
        // 남은 태그(<th-thought>, <추가>)는 화면에 한 글자도 흘리지 않고 끊는다. 부르는 쪽이 다시 쓰게 한다.
        if (LEFTOVER_TAG.matcher(text).find() || LEADING_TAG.matcher(text).find()) return true;
        boolean korean = language == null || "ko".equals(language.getLanguage());
        if (!korean) return false;
        long jamo = text.chars().filter(c -> c >= '\u3131' && c <= '\u318E').count();
        return jamo >= 6;
    }

    // 문장 끝(마침표·물음표·느낌표 뒤 공백)과 줄바꿈에서 나눈다. 따옴표 안 대사 끝의 물음표 뒤에는 공백이 아니라 따옴표가 오므로 나뉘지 않는다.
    private static final Pattern SENTENCE_BREAK = Pattern.compile("(?<=[.?!])[ \\t]+|\\R+");

    private static List<String> sentences(String text) {
        return java.util.Arrays.stream(SENTENCE_BREAK.split(text.strip())).map(String::strip).filter(s -> !s.isEmpty()).toList();
    }

    /** 물음표로 끝나는 문장을 뗀다. 다 떼어지면 원래 말을 그대로 둔다. */
    /**
     * 배우에게 쓰면 안 되는 비유·꾸밈말. 운영과 재생에서 실제로 나온 말이다(2026-10-17~21: "또렷하게 꽂혀요", "튕겨 나갈 거예요",
     * "깊게 눌러주는 무게감", "발음의 날이 무너지지 않고", "에너지 있게 밀고 가는 힘"). 배우가 먼저 쓴 낱말이면 그대로 받아도 된다.
     */
    private static final Pattern METAPHOR = Pattern.compile(
            "화살|꽂(?:혀|히|는|아|힌)|튕겨|뚫어지|에너지|무게|공기가|결이|결을|온도|힘을 실|힘이 실|실려 있|가 닿|묵직|날이 (?:서|무너|살아)|날카로운 힘"
                    + "|살아 있어요|살아나|살아날|불꽃|칼날|파도|가려져요|녹아들|스며들|터져 나오는 힘|꽉 찬|뱉(?:는|어|었|기|고)|튀어나온");

    /** 코치 말에 든 비유 낱말. 배우가 대화에서 먼저 쓴 낱말은 뺀다. 없으면 빈 목록. */
    static List<String> metaphors(String text, String actorWords) {
        if (text == null || text.isBlank()) return List.of();
        String said = actorWords == null ? "" : actorWords;
        var found = new java.util.LinkedHashSet<String>();
        Matcher m = METAPHOR.matcher(text);
        while (m.find()) {
            String word = m.group();
            String stem = word.length() > 2 ? word.substring(0, 2) : word;
            if (!said.contains(stem)) found.add(word);
        }
        return List.copyOf(found);
    }

    /** 코치 말의 마지막 질문 문장. 없으면 빈 문자열. */
    static String lastQuestion(String text) {
        if (text == null) return "";
        var all = sentences(text);
        for (int i = all.size() - 1; i >= 0; i--) if (all.get(i).endsWith("?")) return all.get(i);
        return "";
    }

    private static final Pattern LEAD_WORD = Pattern.compile("^(?:아|네|그럼|그러면|그렇다면)[,.\\s]++");

    private static String normalizedQuestion(String q) {
        String rest = q.strip();
        // 앞의 "아, 그럼"처럼 받는 말을 하나씩 뗀다(중첩 반복 정규식은 긴 입력에서 스택을 넘칠 수 있다).
        for (int i = 0; i < 4; i++) {
            String next = LEAD_WORD.matcher(rest).replaceFirst("");
            if (next.equals(rest)) break;
            rest = next;
        }
        return rest.replaceAll("(?:그|이) 장면에(?:서는|선|서)?", "").replaceAll("[\\s\\p{Punct}“”‘’…·]++", "");
    }

    /** 두 질문이 같은 뜻으로 보이는지. 앞의 "아, 그럼", "그 장면에서" 같은 말과 띄어쓰기를 빼고 두 글자 묶음이 60% 이상 겹치면 같다고 본다. */
    static boolean sameQuestion(String a, String b) {
        String x = normalizedQuestion(a), y = normalizedQuestion(b);
        if (x.length() < 6 || y.length() < 6) return false;
        if (x.equals(y) || x.contains(y) || y.contains(x)) return true;
        var bx = new java.util.HashSet<String>();
        for (int i = 0; i + 2 <= x.length(); i++) bx.add(x.substring(i, i + 2));
        var by = new java.util.HashSet<String>();
        for (int i = 0; i + 2 <= y.length(); i++) by.add(y.substring(i, i + 2));
        long common = bx.stream().filter(by::contains).count();
        return 2.0 * common / (bx.size() + by.size()) >= 0.6;
    }

    /**
     * 이번 코치 말의 마지막 질문이 같은 대화의 앞선 코치 말(전부, 최근 것부터) 질문과 같으면 그 앞 질문을, 아니면 빈 문자열.
     * 2026-10-21 운영: 정리 단계에서 다섯 말 앞의 질문을 글자 그대로 다시 물었다. 최근 넷만 보던 범위라 놓쳤다.
     */
    static String repeatedQuestion(String text, List<String> earlierCoach) {
        String now = lastQuestion(text);
        if (now.isEmpty() || earlierCoach == null) return "";
        for (int i = earlierCoach.size() - 1; i >= 0; i--) {
            for (String sentence : sentences(earlierCoach.get(i))) {
                if (sentence.endsWith("?") && sameQuestion(now, sentence)) return sentence;
            }
        }
        return "";
    }

    private static double overlap(String a, String b) {
        String x = normalizedQuestion(a), y = normalizedQuestion(b);
        if (x.length() < 10 || y.length() < 10) return 0;
        var bx = new java.util.HashSet<String>();
        for (int i = 0; i + 2 <= x.length(); i++) bx.add(x.substring(i, i + 2));
        var by = new java.util.HashSet<String>();
        for (int i = 0; i + 2 <= y.length(); i++) by.add(y.substring(i, i + 2));
        long common = bx.stream().filter(by::contains).count();
        return 2.0 * common / (bx.size() + by.size());
    }

    /**
     * 이번 코치 말에서 바로 앞 코치 말 둘의 문장을 거의 그대로 되풀이한 문장(질문 제외). 둘 이상이거나 말 전체가 되풀이면 그 문장들을,
     * 아니면 빈 목록. 2026-10-21 재생: 반박이 이어지자 같은 피드백 세 문장이 거의 글자 그대로 다시 나갔다.
     */
    static List<String> repeatedLines(String text, List<String> earlierCoach) {
        if (text == null || earlierCoach == null || earlierCoach.isEmpty()) return List.of();
        var before = new ArrayList<String>();
        for (int i = Math.max(0, earlierCoach.size() - 2); i < earlierCoach.size(); i++) before.addAll(sentences(earlierCoach.get(i)));
        var mine = sentences(text).stream().filter(s -> !s.endsWith("?")).toList();
        var repeated = mine.stream().filter(s -> before.stream().anyMatch(b -> overlap(s, b) >= 0.8)).toList();
        return repeated.size() >= 2 || !repeated.isEmpty() && repeated.size() == mine.size() ? repeated : List.of();
    }

    static String withoutQuestions(String text) {
        var kept = sentences(text).stream().filter(s -> !s.endsWith("?")).toList();
        return kept.isEmpty() ? text.strip() : String.join("\n", kept);
    }

    /**
     * 질문 문장이 둘 이상이면 첫 질문까지만 남긴다. 뒤 질문은 대개 앞 질문을 바꿔 묻거나 덧붙인 것이다
     * ("…뭘 해 볼래요? 또는 따지기, 달래기 중 고른다면요?").
     */
    static String firstQuestionOnly(String text) {
        var all = sentences(text);
        if (all.stream().filter(s -> s.endsWith("?")).count() < 2) return text.strip();
        var kept = new ArrayList<String>();
        for (String sentence : all) {
            kept.add(sentence);
            if (sentence.endsWith("?")) break;
        }
        return String.join("\n", kept);
    }

    /** 첫 문장이 배우가 방금 한 말을 10자 넘게 그대로 따라 하면 그 문장을 뗀다. 남는 문장이 없으면 그대로 둔다. */
    static String withoutEcho(String text, String actorText) {
        var all = sentences(text);
        if (all.size() < 2 || actorText == null) return text.strip();
        String first = all.get(0).replaceAll("[\\s\\p{Punct}…]", "");
        String actor = actorText.replaceAll("[\\s\\p{Punct}…]", "");
        if (longestCommon(first, actor) <= 10) return text.strip();
        return String.join("\n", all.subList(1, all.size()));
    }

    private static int longestCommon(String a, String b) {
        int best = 0;
        int[] prev = new int[b.length() + 1];
        for (int i = 1; i <= a.length(); i++) {
            int[] cur = new int[b.length() + 1];
            for (int j = 1; j <= b.length(); j++) {
                if (a.charAt(i - 1) == b.charAt(j - 1)) { cur[j] = prev[j - 1] + 1; best = Math.max(best, cur[j]); }
            }
            prev = cur;
        }
        return best;
    }

    /** 깨진 출력을 한 번 다시 쓰게 할 때 지시 끝에 붙이는 말. */
    static String brokenRetryNote(java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return korean
                ? "[다시 쓰기]\n방금 답은 이 대화와 상관없는 글이었다. 생각은 짧게 끝내고, 배우에게 보일 코치의 말만 짧은 한국어로 쓴다."
                : "[Rewrite]\nYour last answer was unrelated text. Keep your thinking short and write only the coach's words for the actor.";
    }

    static String emptyRetryNote(java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return korean
                ? "[다시 쓰기]\n방금 답에 배우에게 보일 코치의 말이 없었다. 숨은 메모는 짧게 쓰고 닫은 뒤, 그다음 줄에 배우에게 보일 코치의 말을 반드시 쓴다."
                : "[Rewrite]\nYour last answer had no words for the actor. Keep any hidden note short and closed, then on the next line write the coach's words for the actor.";
    }

    /** 시간 표기가 나온 응답을 한 번 다시 쓰게 할 때 지시 끝에 붙이는 말. */
    static String timestampRetryNote(java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return korean
                ? "[다시 쓰기]\n방금 쓴 답에 영상 시간(0:23 같은)이 들어갔다. 같은 내용을 다시 쓰되, 시간 없이 확인된 대사나 그때의 동작·표정·소리로 구간을 가리킨다."
                : "[Rewrite]\nYour last answer pointed to a passage by video time (like 0:23). Write the same content again, pointing to the passage by a confirmed line or by what happens then, with no times.";
    }

    /** 마무리2 응답의 숨은 다음 테이크 줄. 없으면 빈 문자열. */
    static String nextTake(String raw) {
        return raw == null ? "" : first(NEXT_TAKE_TAG, closedNextTake(raw));
    }

    private static final Pattern SENTENCE_END = Pattern.compile("(?<=[.!?。])\\s+|\\n+");
    private static final Pattern ACTION_SENTENCE = Pattern.compile("(?:봐도 좋아요|보세요|봐요)[.!]?$");

    /**
     * 숨은 {@code <다음 테이크>} 줄이 없을 때 정리 말에서 다음 테이크 행동 문장("~해 봐도 좋아요")을 뽑는다(SOMA-657).
     * 3.8 Flash는 정리 14번 중 3번 숨은 줄을 빠뜨렸다. 그대로 두면 노트에 처음 설계의 다음 테이크가 남아 코치가 한 말과 달라진다.
     * "다음 테이크에서 확인해 봐요" 같은 맺음말은 행동이 아니라 고르지 않는다. 없으면 빈 문자열.
     */
    static String actionLine(String shown) {
        if (shown == null || shown.isBlank()) return "";
        for (String sentence : SENTENCE_END.split(shown.strip())) {
            String line = sentence.strip();
            if (line.isEmpty() || line.contains("다음 테이크에서") || line.startsWith("특히")) continue;
            if (ACTION_SENTENCE.matcher(line).find()) return line.replaceFirst("[.!]$", "");
        }
        return "";
    }

    /**
     * 이번 응답을 쓸 말. 앱이 한국어가 아닌 말로 요청했으면(Accept-Language, {@link OutputLanguage}) 그 말,
     * 앱이 한국어면 배우가 채팅이나 연습 메모에 쓴 말({@link #actorLanguage}). 한국어면 {@code null}.
     * 운영에서 영어로 상황을 적은 배우에게 한국어로 첫 질문을 하자 답하지 않고 떠났다.
     */
    static java.util.Locale replyLanguage(CoachSessionSnapshot session, String actorText) {
        if (OutputLanguage.isKorean()) return actorLanguage(session, actorText);
        // 화면이 한국어가 아니어도 배우가 대화에서 한국어로 답하면 한국어로 답한다.
        // 2026-10-15 00:12 운영(자문, 영어 화면): 배우는 내내 한국어로 답했는데 코치는 영어로 답했다.
        return actorWritesKorean(session, actorText) ? null : OutputLanguage.current();
    }

    /** 배우가 이 대화에서 쓴 말(이번 답 → 지난 답, 최근부터)이 한국어인지. 연습 메모는 보지 않는다. 판단되는 말이 없으면 아니다. */
    static boolean actorWritesKorean(CoachSessionSnapshot session, String actorText) {
        var candidates = new ArrayList<String>();
        if (actorText != null) candidates.add(actorText);
        if (session != null) {
            List<CoachTurnSnapshot> turns = session.turns();
            for (int i = turns.size() - 1; i >= 0; i--) if (!"ai".equals(turns.get(i).role())) candidates.add(turns.get(i).text());
        }
        for (String text : candidates) {
            if (text == null || text.isBlank() || com.acttub.actingapi.feature.coach.domain.ClosingIntent.isClosing(text)) continue;
            String lowered = text.toLowerCase(java.util.Locale.ROOT);
            if (lowered.contains("in english") || lowered.contains("영어로")) return false;
            if (lowered.contains("한국어로") || lowered.contains("in korean")) return true;
            java.util.Locale found = languageOf(text);
            if (found == null) return true;
            if (found != UNDECIDED) return false;
        }
        return false;
    }

    /**
     * 배우가 쓰는 말. 이번 답 → 지난 답(최근부터) → 연습 메모 순으로 처음 판단되는 것. 모르면 {@code null}(한국어).
     * "그만" 같은 종료·짧은 말은 건너뛴다. 배우가 "한국어로"/"in English"라고 하면 그것을 따른다.
     */
    static java.util.Locale actorLanguage(CoachSessionSnapshot session, String actorText) {
        var candidates = new ArrayList<String>();
        if (actorText != null) candidates.add(actorText);
        if (session != null) {
            List<CoachTurnSnapshot> turns = session.turns();
            for (int i = turns.size() - 1; i >= 0; i--) if (!"ai".equals(turns.get(i).role())) candidates.add(turns.get(i).text());
            candidates.add(String.join(" ", java.util.stream.Stream.of(session.situation(), session.characterContext(),
                    session.goal(), session.blockageDetail()).filter(v -> v != null && !blank(v)).toList()));
        }
        for (String text : candidates) {
            if (text == null || text.isBlank() || com.acttub.actingapi.feature.coach.domain.ClosingIntent.isClosing(text)) continue;
            String lowered = text.toLowerCase(java.util.Locale.ROOT);
            if (lowered.contains("한국어로") || lowered.contains("in korean")) return null;
            if (lowered.contains("in english") || lowered.contains("영어로")) return java.util.Locale.ENGLISH;
            java.util.Locale found = languageOf(text);
            if (found != UNDECIDED) return found;
        }
        return null;
    }

    private static final Pattern PLACEHOLDER = Pattern.compile("\\[(상대|인물)\\]");

    /** 첫 질문 모양의 자리표시가 그대로 남았으면 말로 바꾼다. "[상대]" → "상대", "[인물]" → "이 인물". */
    static String withoutPlaceholders(String text) {
        if (text == null || text.indexOf('[') < 0) return text;
        return PLACEHOLDER.matcher(text).replaceAll(m -> "상대".equals(m.group(1)) ? "상대" : "이 인물");
    }

    private static final java.util.Locale UNDECIDED = java.util.Locale.ROOT;

    /** 글자 수로 가린다. 한글이 있으면 한국어(null), 가나가 있으면 일본어, 로마자 단어가 충분하면 영어. */
    static java.util.Locale languageOf(String text) {
        long hangul = text.codePoints().filter(c -> c >= 0xAC00 && c <= 0xD7A3).count();
        long kana = text.codePoints().filter(c -> c >= 0x3040 && c <= 0x30FF).count();
        long latin = text.codePoints().filter(c -> (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')).count();
        if (hangul > 0 && hangul * 3 >= latin) return null;
        if (kana >= 2) return java.util.Locale.JAPANESE;
        if (latin >= 8 && hangul == 0) return java.util.Locale.ENGLISH;
        return UNDECIDED;
    }

    /** 연기 장면을 담기에는 너무 짧은 영상(밀리초). 이보다 짧으면 모델을 부르지 않고 끊는다. */
    static final int MIN_ACTING_MS = 3000;
    static final String NOT_ACTING = "not_acting";

    /**
     * 첫 응답 전에 영상 길이만으로 끊을지. 운영에서 1.3초 영상으로 코치가 버릇과 대사를 지어냈다.
     * 길이를 모르면(0) 끊지 않고 모델의 판정({@link #notActing})에 맡긴다.
     */
    static boolean tooShort(CoachSessionSnapshot session) {
        return session.turns().isEmpty() && session.durationMs() > 0 && session.durationMs() < MIN_ACTING_MS;
    }

    /**
     * 첫 응답의 {@code <설계>} 첫 칸이 "연기 아님"인지. 실제 영상·음성 내용의 분류는 모델이 하고,
     * 끊는 것은 서버가 한다. 검은 화면 자체는 차단 근거가 아니며, 실제 들리는 음성 연기는 허용한다.
     */
    static boolean notActing(Parsed parsed) {
        return statusField(parsed.design(), "영상").startsWith("연기 아님");
    }

    /** 연기 영상이 아니어서 끊을 때 배우에게 보이는 고정 문구. */
    static String notActingMessage(java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return korean
                ? "이 영상에서는 연기 장면을 찾지 못했어요.\n연기한 장면이 담긴 영상을 다시 올려 주세요."
                : "I couldn't find an acting scene in this video.\nPlease upload a video with your acting in it.";
    }

    /** 끊은 세션 표시. 노트를 만들지 않는 근거다. */
    static void markNotActing(ObjectNode state, String reason) {
        ObjectNode loop = state.path(STATE_KEY).isObject() ? (ObjectNode) state.get(STATE_KEY) : state.putObject(STATE_KEY);
        loop.put(NOT_ACTING, reason);
    }

    /** 오디오가 완전 무음인 입력의 안내. 연기 여부를 거짓 판정하지 않는다. */
    static String audioUnavailableMessage(java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return korean
                ? "영상의 소리가 녹음되지 않았어요.\n소리가 들리는 영상으로 다시 올려 주세요."
                : "The video's audio is silent.\nPlease upload a video with audible sound.";
    }

    static void markInputIssue(ObjectNode state, String reason) {
        ObjectNode loop = state.path(STATE_KEY).isObject() ? (ObjectNode) state.get(STATE_KEY) : state.putObject(STATE_KEY);
        loop.put("input_issue", reason);
    }

    /** 비연기 또는 입력 문제로 코칭을 시작하지 않고 끊은 세션인지. */
    static boolean wasCut(JsonNode state) {
        return state != null && (!state.path(STATE_KEY).path(NOT_ACTING).asText("").isEmpty()
                || !state.path(STATE_KEY).path("input_issue").asText("").isEmpty());
    }

    /** 이 세션이 연습 루프로 시작됐는지. 루프 전에 열린 세션은 기존 경로로 이어간다. */
    static boolean applies(CoachSessionSnapshot session) {
        return session.turns().isEmpty() || session.coachingState() != null
                && session.coachingState().path(STATE_KEY).isObject();
    }

    /**
     * 배우가 이번 연습에 적은 것(상황·인물·목표·막힘)을 연습 루프 프롬프트 앞에 붙일 칸으로 만든다.
     *
     * <p>프롬프트는 "배우가 적은 것" 이라는 이름으로 이 칸을 찾는다. <b>빈 칸은 줄을 만들지 않고, 모두 비면
     * 칸 자체를 만들지 않는다</b> — 빈 제목만 남으면 모델이 그 자리를 지어낸다. 그래서 영상만 올린 연습은
     * 예전과 똑같은 프롬프트를 받는다. 막힘을 건너뛴 값 {@code 그 외} 는 배우가 적은 것이 아니므로 싣지 않는다.
     */
    static String actorMaterial(CoachSessionSnapshot session) {
        var lines = new ArrayList<String>();
        field(lines, "상황", session.situation());
        field(lines, "인물", session.characterContext());
        field(lines, "목표", session.goal());
        if (!skipped(session.blockageKind())) {
            lines.add("- 막힌 곳: " + session.blockageKind().strip()
                    + (skipped(session.subBranch()) ? "" : " · " + session.subBranch().strip()));
        }
        field(lines, "막힌 곳 설명", session.blockageDetail());
        if (lines.isEmpty()) return "";
        return "## 배우가 적은 것\n이번 연습을 올리며 배우가 적은 것이다. 영상 근거가 아니다.\n"
                + String.join("\n", lines) + "\n\n";
    }

    private static void field(List<String> lines, String label, String value) {
        if (!blank(value)) lines.add("- " + label + ": " + value.strip());
    }

    /** 배우가 고르지 않은 막힘. 웹·앱은 건너뛰면 {@code 그 외} 를 보낸다. */
    private static boolean skipped(String value) {
        return blank(value) || "그 외".equals(value.strip());
    }

    /** 빈 칸. {@code "."} 은 입력 칸을 넘기려고 찍은 점이라 빈 것으로 본다. */
    private static boolean blank(String value) {
        return value == null || value.isBlank() || ".".equals(value.strip());
    }

    /** 저장된 표시용 대화에 숨은 칸을 되붙여 모델에 넘길 기록을 만든다. */
    static List<DirectVideoModel.Message> history(List<CoachTurnSnapshot> turns, JsonNode state, String actorText) {
        return history(turns, state, actorText, true);
    }

    /**
     * 모델에 넘길 기록. {@code withStatuses}가 거짓이면 첫 응답의 {@code <설계>}만 되붙인다 — 둘째 응답부터는
     * 서버가 할 일을 정하므로 지난 상태 칸을 보여 주지 않는다(모델이 상태 칸을 따라 쓰지 않게).
     */
    static List<DirectVideoModel.Message> history(List<CoachTurnSnapshot> turns, JsonNode state, String actorText,
            boolean withStatuses) {
        JsonNode loop = state == null ? null : state.path(STATE_KEY);
        String design = loop == null ? "" : loop.path("design").asText("");
        var history = new ArrayList<DirectVideoModel.Message>();
        int coachIndex = 0;
        for (CoachTurnSnapshot turn : turns) {
            if (!"ai".equals(turn.role())) {
                history.add(new DirectVideoModel.Message("user", turn.text()));
                continue;
            }
            String text = turn.text();
            if (coachIndex == 0 && !design.isBlank()) {
                text = "<설계>\n" + design + "\n</설계>\n<코치>\n" + text + "\n</코치>";
            } else if (withStatuses) {
                String status = loop == null ? "" : loop.path("statuses").path(coachIndex).asText("");
                if (!status.isBlank()) text = "<상태>" + status + "</상태>\n" + text;
            }
            history.add(new DirectVideoModel.Message("model", text));
            coachIndex++;
        }
        if (actorText != null) history.add(new DirectVideoModel.Message("user", actorText));
        return history;
    }

    /** 이 대화가 받은 코치 성격(SOMA-622). 자문위원 대화가 아니면 빈 문자열. */
    static String storedPersona(JsonNode state) {
        return state == null ? "" : state.path(STATE_KEY).path("persona").asText("");
    }

    static void rememberPersona(ObjectNode state, String persona) {
        ObjectNode loop = state.path(STATE_KEY).isObject() ? (ObjectNode) state.get(STATE_KEY) : state.putObject(STATE_KEY);
        if (loop.path("persona").asText("").isEmpty()) loop.put("persona", persona);
    }

    /** 이 대화의 코치 흐름(SOMA-636 A/B). "a"는 지금 흐름, "b"는 세 단계 흐름. 없으면 빈 문자열(배포 전 대화). */
    static String storedFlow(JsonNode state) {
        return state == null ? "" : state.path(STATE_KEY).path("flow").asText("");
    }

    static void rememberFlow(ObjectNode state, String flow) {
        ObjectNode loop = state.path(STATE_KEY).isObject() ? (ObjectNode) state.get(STATE_KEY) : state.putObject(STATE_KEY);
        if (loop.path("flow").asText("").isEmpty()) loop.put("flow", flow);
    }

    /** 이 대화의 첫 말 쪽(첫 코칭 첫 말 A/B). "a"는 질문 한 줄, "b"는 본 것과 다음 테이크를 먼저. 없으면 빈 문자열(배포 전 대화). */
    static String storedOpening(JsonNode state) {
        return state == null ? "" : state.path(STATE_KEY).path("opening").asText("");
    }

    static void rememberOpening(ObjectNode state, String opening) {
        ObjectNode loop = state.path(STATE_KEY).isObject() ? (ObjectNode) state.get(STATE_KEY) : state.putObject(STATE_KEY);
        if (loop.path("opening").asText("").isEmpty()) loop.put("opening", opening);
    }

    /** 이 대화의 "이미 그렇게 했다" 처리 쪽(SOMA-855). "on"은 실험, "off"는 대조. 없으면 빈 문자열(배포 전 대화). */
    static String storedAlready(JsonNode state) {
        return state == null ? "" : state.path(STATE_KEY).path("already_ab").asText("");
    }

    static void rememberAlready(ObjectNode state, String arm) {
        ObjectNode loop = state.path(STATE_KEY).isObject() ? (ObjectNode) state.get(STATE_KEY) : state.putObject(STATE_KEY);
        if (loop.path("already_ab").asText("").isEmpty()) loop.put("already_ab", arm);
    }

    /** 이 대화의 코치 모델 쪽(SOMA-657). "a"는 기본 모델, "b"는 비교 모델. 없으면 빈 문자열. */
    static String storedCoachModel(JsonNode state) {
        return state == null ? "" : state.path(STATE_KEY).path("coach_model").asText("");
    }

    static void rememberCoachModel(ObjectNode state, String arm) {
        ObjectNode loop = state.path(STATE_KEY).isObject() ? (ObjectNode) state.get(STATE_KEY) : state.putObject(STATE_KEY);
        if (loop.path("coach_model").asText("").isEmpty()) loop.put("coach_model", arm);
    }

    /** 이번 응답의 숨은 칸을 상태에 쌓는다. statuses 의 순서는 코치 턴의 순서와 같다. */
    static void remember(ObjectNode state, Parsed parsed) {
        ObjectNode loop = state.path(STATE_KEY).isObject() ? (ObjectNode) state.get(STATE_KEY) : state.putObject(STATE_KEY);
        if (!parsed.design().isBlank() && loop.path("design").asText("").isBlank()) loop.put("design", parsed.design());
        ArrayNode statuses = loop.path("statuses").isArray() ? (ArrayNode) loop.get("statuses") : loop.putArray("statuses");
        statuses.add(parsed.status());
    }

    /**
     * 코치가 마무리를 마쳤는지. 상태 줄의 칸 중 하나(이번 응답이 하는 일)가 마무리2 또는 끝이다.
     * 프롬프트 판마다 그 칸의 자리가 다르다("순간2 · 마무리2 · …", "마무리2 · 응답 6번째").
     * 여러 줄 상태 칸("배우의 말: …" · "할 일: 마무리2")은 {@code 할 일} 줄만 본다.
     */
    static boolean finished(Parsed parsed) {
        String doing = statusField(parsed.status(), "할 일");
        if (!doing.isEmpty()) return doing.startsWith("마무리2") || doing.startsWith("끝");
        for (String part : parsed.status().split("·")) {
            String action = part.strip();
            if (action.startsWith("마무리2") || action.startsWith("끝")) return true;
        }
        return false;
    }

    private static final Pattern DESIGN_HABIT = Pattern.compile("(?m)^\\s*버릇\\s*:\\s*\\[?([^|\\]\\n]+)");
    private static final Pattern DESIGN_NEXT = Pattern.compile("(?m)^\\s*다음 테이크\\s*:\\s*\\[?([^\\]\\n]+)");
    private static final Pattern VAGUE = Pattern.compile("(?:잘\\s*)?(?:모르겠(?:어|어요|다|음)?|몰라(?:요)?|ㅇㅇ|ㅇㅋ|네|넵|응|아 네)[.!?~\\s]*");
    private static final int TITLE_MAX = 40;

    /**
     * 연습 루프 세션의 노트(3층). 코치가 이미 정리해 둔 것으로 채운다 — 영상 직접 코칭은 구조화된
     * 방향·초점을 만들지 않아 기존 노트 생성기는 record_only 로 떨어진다.
     *
     * <p>제목은 이번 버릇, 요약은 배우가 쓴 자기에 대한 한 줄과 버릇이 나온 이유(배우의 말 원문),
     * 다음 촬영은 설계의 다음 테이크 한 가지다. 연습 루프가 아니거나 설계가 없으면 {@code null}.
     */
    static ConversationRepository.NewNote note(CoachSessionSnapshot session, long sourceRevision) {
        JsonNode state = session.coachingState();
        JsonNode loop = state == null ? null : state.path(STATE_KEY);
        if (loop == null || !loop.isObject() || wasCut(state)) return null;
        String design = loop.path("design").asText("");
        String habit = habit(design);
        // 설계의 "다음 테이크: 없음"(영상 없이 말로 첫 응답 등)은 다음 테이크가 아니다 — 그대로 쓰면 노트에 "없음"이 제안으로 남았다(10/26 운영 4건).
        String next = noneAsBlank(first(DESIGN_NEXT, design));
        // 정리에서 정한 다음 테이크. 설계에 버릇·다음 테이크 줄이 없는 목적별 코칭(막힌 곳·고민 상담)도 이것으로 노트를 채운다 —
        // 예전에는 여기서 null 을 돌려 생성기로 넘어가 정리한 제안이 있어도 빈 노트(record_only)가 됐다(10/25·26 운영).
        String closingNext = closingNextTake(loop.path("statuses"));
        if (habit.isBlank() && next.isBlank() && closingNext.isBlank()) return null;
        var mapper = com.acttub.actingapi.integration.llm.StructuredJson.MAPPER;
        Round round = round(loop, session.turns());
        var quotes = mapper.createArrayNode();
        if (round.selfLine() != null) quotes.addObject().put("quote", round.selfLine()).put("kind", "actor")
                .put("source_ref", StructuredCoachEngine.turnId(session, round.selfIndex()));
        // 배우가 자기 한 줄을 남기지 않았으면 코치가 영상에서 본 버릇을 요약 첫 줄로 둔다. 마지막 답 하나만 남으면 엉뚱하다.
        if (round.selfLine() == null && !habit.isBlank()) quotes.addObject().put("quote", shorten(habit, 80)).put("kind", "observation")
                .put("source_ref", StructuredCoachEngine.turnId(session, 0));
        if (round.reason() != null) quotes.addObject().put("quote", round.reason()).put("kind", "actor")
                .put("source_ref", StructuredCoachEngine.turnId(session, round.reasonIndex()));
        String title = habit.isBlank() ? null : shorten(habit, TITLE_MAX);
        // 마무리2의 상태 칸에 다시 정한 다음 테이크가 있으면 그것을 쓴다 — 배우가 그 버릇을 지키겠다고 했으면 설계의 "반대쪽"과 다르다.
        if (!closingNext.isBlank()) next = closingNext;
        String nextTake = next.isBlank() ? null : next;
        var empty = mapper.createArrayNode();
        // 배우가 아니라고 한 것(정정·반박)은 노트의 corrections 에 남는다(세션.md, SOMA-602).
        var corrections = mapper.createArrayNode();
        round.corrections().forEach(corrections::add);
        return new ConversationRepository.NewNote("v2", nextTake == null ? "observation" : "action", title, quotes,
                nextTake, empty, corrections, empty, false, sourceRevision, null);
    }

    /**
     * 한 회차에서 배우가 한 말을 세션.md 칸으로 가른다(SOMA-601·602). 모델을 부르지 않고 숨은 상태 칸의 분류를 읽는다.
     *
     * @param selfLine 배우의 한 줄. 자기 한 줄로 분류된 말이 우선이고, 없으면 한 줄을 청한 직후의 답(요청·반박 제외)
     * @param reason 버릇이 나온 이유. 선택 설명으로 분류된 답이 우선이고, 없으면 파고들기 직후의 답(짧은 답 제외)
     * @param corrections 배우가 아니라고 한 것. "주제: \"원문\"" 꼴
     * @param goal 이번 목표. 상태 칸의 이번 목표 줄, 없으면 설계의 이번 목표. 없으면 {@code null}
     */
    record Round(String selfLine, int selfIndex, String reason, int reasonIndex, List<String> corrections, String goal) {}

    static Round round(JsonNode loop, List<CoachTurnSnapshot> turns) {
        JsonNode statuses = loop.path("statuses");
        String design = loop.path("design").asText("");
        String habit = habit(design);
        String selfLine = null;
        int selfIndex = -1;
        String askedLine = null;
        int askedIndex = -1;
        String choice = null;
        int choiceIndex = -1;
        String probe = null;
        int probeIndex = -1;
        List<String> corrections = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        String lastAction = "";
        int coachIndex = 0;
        for (int i = 0; i < turns.size(); i++) {
            CoachTurnSnapshot turn = turns.get(i);
            if ("ai".equals(turn.role())) {
                lastAction = action(statuses.path(coachIndex++).asText(""));
                continue;
            }
            String text = turn.text() == null ? "" : turn.text().strip();
            if (text.isEmpty() || VAGUE.matcher(text).matches()
                    || com.acttub.actingapi.feature.coach.domain.ClosingIntent.isClosing(text)) continue;
            // 이 답을 받은 다음 코치 턴의 상태 칸이 배우의 말을 분류해 두었다.
            String status = statuses.path(coachIndex).asText("");
            String kind = statusField(status, "배우의 말");
            if (kind.startsWith("자기 한 줄")) {
                selfLine = text;
                selfIndex = i;
            } else if (kind.startsWith("정정") || kind.startsWith("반박")) {
                String topic = statusField(status, "피할 것");
                if (topic.isEmpty() || topic.startsWith("없음")) topic = habit;
                if (seen.add(text.replaceAll("[\\s!?.~…ㅠㅜ]+", ""))) {
                    corrections.add((topic.isBlank() ? "" : shorten(topic, 30) + ": ") + "\"" + shorten(text, 80) + "\"");
                }
            } else if (lastAction.startsWith("마무리1") && askedLine == null && !request(kind, text)) {
                // 한 줄을 청한 자리에서 배우가 평가·방법을 청하거나 반박했으면 그 말은 한 줄이 아니다(SOMA-601).
                askedLine = text;
                askedIndex = i;
            } else if (kind.startsWith("선택 설명")) {
                choice = text;
                choiceIndex = i;
            } else if (lastAction.startsWith("파고들기") && !lastAction.startsWith("파고들기(") && !kind.startsWith("짧은 답")) {
                // 고르기만 하면 되는 쉬운 질문(파고들기(쉬운))의 답은 이유가 아니다 — "무서워할 쪽이요"가 요약에 올라갔다.
                // 버릇이 언제·왜 나오는지에 대한 배우의 마지막 답.
                probe = text;
                probeIndex = i;
            }
        }
        if (selfLine == null) {
            selfLine = askedLine;
            selfIndex = askedIndex;
        }
        String reason = choice != null ? choice : probe;
        int reasonIndex = choice != null ? choiceIndex : probeIndex;
        return new Round(selfLine, selfIndex, reason, reasonIndex, List.copyOf(corrections), goal(statuses, design));
    }

    /** 이번 목표. 마지막 상태 칸의 이번 목표 줄, 없으면 설계의 이번 목표. "없음"이나 빈 값이면 {@code null}. */
    static String goal(JsonNode statuses, String design) {
        if (statuses != null && statuses.isArray()) {
            for (int i = statuses.size() - 1; i >= 0; i--) {
                String value = statusField(statuses.get(i).asText(""), "이번 목표");
                if (!value.isEmpty() && !value.startsWith("없음")) return value;
            }
        }
        String designed = statusField(design, "이번 목표");
        return designed.isEmpty() || designed.startsWith("없음") ? null : designed;
    }

    /** 상태 칸이 분류한 요청·반박·종료. 분류가 없던 옛 대화는 요청을 나타내는 낱말로 가른다. */
    private static final Pattern REQUEST_WORDS = Pattern.compile(
            "평가|장점|단점|방법|예시|설명해|어떻게 해야|부족한|짚어 ?주|(?i:how (?:do|should) i|feedback|example)");

    private static boolean request(String kind, String text) {
        if (kind.startsWith("평가 요청") || kind.startsWith("방법 요청") || kind.startsWith("반박")
                || kind.startsWith("정정") || kind.startsWith("그만")) return true;
        return kind.isEmpty() && REQUEST_WORDS.matcher(text).find();
    }

    private static final Pattern NEXT_TAKE_PREFIX = Pattern.compile("^(?:지키며|반대로)\\s*:\\s*");

    /** 마지막으로 상태 칸에 적힌 다음 테이크("지키며: …", "반대로: …"). 없거나 "없음"이면 빈 문자열. */
    static String closingNextTake(JsonNode statuses) {
        if (statuses == null || !statuses.isArray()) return "";
        for (int i = statuses.size() - 1; i >= 0; i--) {
            String value = statusField(statuses.get(i).asText(""), "다음 테이크");
            if (value.isEmpty() || value.startsWith("없음")) continue;
            return NEXT_TAKE_PREFIX.matcher(value).replaceFirst("").strip();
        }
        return "";
    }

    /** "없음"·"모름"으로 시작하는 칸 값은 빈 값으로 본다. */
    static String noneAsBlank(String value) {
        if (value == null) return "";
        String v = value.strip();
        return v.startsWith("없음") || v.startsWith("모름") ? "" : v;
    }

    /** 설계의 다음 테이크(버릇의 반대쪽). 없으면 빈 문자열. */
    static String designNextTake(String design) {
        return first(DESIGN_NEXT, design == null ? "" : design);
    }

    /** 상태 줄에서 이번 응답이 한 일. 첫 턴(상태 없음)은 비추기다. */
    static String action(String status) {
        if (status.isBlank()) return "비추기";
        String doing = statusField(status, "할 일");
        if (!doing.isEmpty()) return doing;
        for (String part : status.split("·")) {
            String value = part.strip();
            if (!value.startsWith("응답") && !value.startsWith("순간") && !value.startsWith("장면")
                    && !value.startsWith("누적")) return value;
        }
        return "";
    }

    private static String shorten(String text, int max) {
        String value = text.strip().replaceAll("[.。]+$", "");
        if (value.codePointCount(0, value.length()) <= max) return value;
        int cut = value.offsetByCodePoints(0, max);
        int space = value.lastIndexOf(' ', cut);
        return (space > max / 2 ? value.substring(0, space) : value.substring(0, cut)).strip() + "…";
    }

    private static final Pattern HABIT_CATEGORY = Pattern.compile("소리\\s*(?:빠르기|말끝|크기|쉬는\\s*곳|강조)|몸");

    /** 설계의 버릇. 모델이 설명 대신 항목 이름("소리 빠르기")을 적었으면 그 항목 줄의 설명을 쓴다. */
    static String habit(String design) {
        String habit = first(DESIGN_HABIT, design);
        if (!HABIT_CATEGORY.matcher(habit).matches()) return habit;
        Matcher line = Pattern.compile("(?m)^\\s*" + Pattern.quote(habit) + "\\s*:\\s*\\[?([^\\]\\n]+)").matcher(design);
        if (!line.find()) return habit;
        String described = line.group(1).split("[.\"“]", 2)[0].strip();
        return described.isBlank() || described.equals("없음") ? habit : described;
    }

    /**
     * 여러 줄 상태 칸의 {@code 키: 값} 줄에서 값을 읽는다. 모델이 양식의 대괄호를 남겨도 벗긴다. 없으면 빈 문자열.
     * 한 줄 상태("파고들기 · 응답 2번째")에는 이 줄이 없으므로 호출하는 쪽이 기존 해석으로 돌아간다.
     */
    static String statusField(String status, String key) {
        if (status == null || status.isBlank()) return "";
        Matcher line = Pattern.compile("(?m)^\\s*" + Pattern.quote(key) + "\\s*:\\s*(.*?)\\s*$").matcher(status);
        if (!line.find()) return "";
        return line.group(1).replaceAll("^\\[|\\]$", "").strip();
    }

    private static String first(Pattern pattern, String text) {
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(1).strip() : "";
    }
}
