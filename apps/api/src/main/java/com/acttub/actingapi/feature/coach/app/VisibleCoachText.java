package com.acttub.actingapi.feature.coach.app;

import java.util.List;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 모델이 쓰는 원문 조각에서 배우에게 보일 부분만 골라 흘려보낸다(코칭 스트리밍).
 *
 * <p>거르는 것은 숨은 칸뿐이다(<설계>·<상태>·<생각>·<다음 테이크>, 첫 응답의 <코치> 바깥, 닫는 태그를 빠뜨린 메모 줄).
 * 질문 하나만 남기기·시간 표기 지우기·되풀이 떼기·줄이기 같은 다듬기는 하지 않는다 — 스트리밍에서는 프롬프트 규칙만 믿는다
 * (2026-10-16 사용자 결정). 아직 숨은 칸인지 모르는 끝부분(열리다 만 태그, 메모 이름일 수 있는 줄 머리)은 다음 조각까지 잡아 둔다.
 *
 * <p>나중 조각 때문에 이미 보낸 글이 숨은 칸이었다고 밝혀지면 더 보내지 않는다. 화면은 마지막에 오는 저장된 답으로 덮어쓴다.
 *
 * <p>보일 글이 깨졌으면(날 자모 반복, HTML·코드) 더 흘리지 않고 {@link Broken} 을 던져 이번 쓰기를 끊는다. 부르는 쪽이 다시 쓰게 한다.
 * 끝에 붙은 날 자모는 깨진 글의 시작일 수 있어 다음 조각까지 잡아 둔다(2026-10-20 dev, 답 자리에 "ㅇㄹㄴㅁ…"가 11초 동안 흘렀다).
 */
final class VisibleCoachText {
    private static final String HIDDEN_NAME = "(?:설계|상태|다음 테이크|보기|카드|인물 카드|장면|생각|thought|think|thinking)";
    private static final Pattern HIDDEN_BLOCK = Pattern.compile("(?is)<(" + HIDDEN_NAME + ")>.*?</\\1>");
    private static final Pattern HIDDEN_OPEN = Pattern.compile("(?i)<" + HIDDEN_NAME + ">");
    private static final Pattern THINKING_CLOSE = Pattern.compile("(?i)</(?:생각|thought|think|thinking)>");
    private static final Pattern STRAY_TAG = Pattern.compile("(?iu)</?(?:설계|상태|코치|다음 테이크|보기|카드|인물 카드|장면|생각|thought|think|thinking)>");
    private static final Pattern COMPLETE_UNCLOSED_THINKING_LINE = Pattern.compile(
            "(?im)^[ \\t]*</?(?:생각|thought|think|thinking)(?![\\p{L}\\p{N}_>-])[^>\\n]*\\R");
    private static final List<String> MEMO_LABELS = List.of("배우가 한 말", "배우가 지금 원하는 것", "이번 목표", "내 대답", "끝 질문", "글자 수");
    private static final Pattern MEMO_LINE = Pattern.compile(
            "(?m)^\\s*(?:배우가 한 말|배우가 지금 원하는 것|이번 목표|내 대답|끝 질문|글자 수)\\s*:.*(?:\\R|$)");
    private static final String COACH_OPEN = "<코치>";
    private static final String COACH_CLOSE = "</코치>";

    private final boolean opening;
    private final java.util.Locale language;
    private final Consumer<String> out;
    private final StringBuilder raw = new StringBuilder();
    private String sent = "";

    /** @param opening 첫 응답이면 {@code <코치>} 안만 보인다. 그 앞은 숨은 설계다. */
    VisibleCoachText(boolean opening, Consumer<String> out) {
        this(opening, null, out);
    }

    /** @param language 답 언어. 깨진 글 판단에 쓴다({@code null} 이면 한국어). */
    VisibleCoachText(boolean opening, java.util.Locale language, Consumer<String> out) {
        this.opening = opening;
        this.language = language;
        this.out = out;
    }

    /** 보일 글이 깨져서 이번 쓰기를 끊었다. {@link #text()} 는 그때까지의 보일 글이다. */
    static final class Broken extends RuntimeException {
        private final String text;

        Broken(String text) {
            super("broken coach stream", null, false, false);
            this.text = text;
        }

        String text() {
            return text;
        }
    }

    void accept(String piece) {
        if (piece == null || piece.isEmpty()) return;
        raw.append(piece);
        String visible = visible(raw.toString(), opening);
        if (DirectVideoPracticeLoop.looksBrokenSoFar(visible, language)) throw new Broken(visible);
        visible = holdTrailingJamo(visible);
        if (visible.length() > sent.length() && visible.startsWith(sent)) {
            out.accept(visible.substring(sent.length()));
            sent = visible;
        }
    }

    /** 다시 쓰기(빈 답) 전에 원문만 비운다. 이미 보낸 글은 기억해 두어 같은 글을 두 번 보내지 않는다. */
    void restart() {
        raw.setLength(0);
    }

    String sent() {
        return sent;
    }

    /** 지금까지의 원문에서 확실히 보일 글. */
    static String visible(String raw, boolean opening) {
        String text = raw;
        if (opening) {
            int design = text.indexOf("</설계>");
            // 연기 아님으로 분류한 첫 응답은 서버가 고정 문구로 끊는다. 모델의 <코치> 말("없음")은 보이지 않는다.
            if (design >= 0 && DirectVideoPracticeLoop.notActing(DirectVideoPracticeLoop.parse(text.substring(0, design + 5)))) return "";
        }
        int coach = text.indexOf(COACH_OPEN);
        if (coach >= 0) {
            text = text.substring(coach + COACH_OPEN.length());
            int close = text.indexOf(COACH_CLOSE);
            if (close >= 0) text = text.substring(0, close);
        } else if (opening) {
            return "";
        }
        text = HIDDEN_BLOCK.matcher(text).replaceAll("");
        // 여는 태그 없이 </생각>만 나오면 그 앞은 모두 메모다(parse 와 같다).
        Matcher close = THINKING_CLOSE.matcher(text);
        int strayClose = -1;
        while (close.find()) strayClose = close.end();
        if (strayClose >= 0) text = text.substring(strayClose);
        Matcher open = HIDDEN_OPEN.matcher(text);
        if (open.find()) text = text.substring(0, open.start());
        // 꺾쇠를 닫지 않은 메모 태그 줄("<thought" + 줄바꿈)은 떼고 그 아래를 보인다. 줄이 아직 안 끝났으면 아래에서 잡아 둔다.
        text = COMPLETE_UNCLOSED_THINKING_LINE.matcher(text).replaceAll("");
        int lt = text.lastIndexOf('<');
        if (lt >= 0 && text.indexOf('>', lt) < 0) text = text.substring(0, lt);
        text = MEMO_LINE.matcher(text).replaceAll("");
        text = holdMemoHead(text);
        text = STRAY_TAG.matcher(text).replaceAll("");
        return text.stripLeading();
    }

    /** 끝에 붙은 날 자모(와 그 사이 공백)는 깨진 글의 시작일 수 있어 다음 조각까지 잡아 둔다. */
    static String holdTrailingJamo(String text) {
        int start = text.length();
        boolean jamo = false;
        while (start > 0) {
            char c = text.charAt(start - 1);
            boolean isJamo = c >= '\u3131' && c <= '\u318E';
            if (!isJamo && !Character.isWhitespace(c)) break;
            jamo |= isJamo;
            start--;
        }
        return jamo ? text.substring(0, start) : text;
    }

    /** 끝 줄이 아직 메모 이름("이번 목표:")일 수 있으면 그 줄은 다음 조각까지 잡아 둔다. */
    private static String holdMemoHead(String text) {
        int lineStart = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r')) + 1;
        String head = text.substring(lineStart).strip();
        if (head.isEmpty()) return text;
        for (String label : MEMO_LABELS) {
            if ((label + ":").startsWith(head)) return text.substring(0, lineStart);
            if (head.startsWith(label) && head.substring(label.length()).strip().startsWith(":")) return text.substring(0, lineStart);
            if (head.startsWith(label) && head.substring(label.length()).isBlank()) return text.substring(0, lineStart);
        }
        return text;
    }
}
