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
    private static final Pattern STRAY_TAG = Pattern.compile("</?(?:설계|상태|코치)>");
    // 모델이 줄 끝에 남기는 날 자모("알려 주세요.ㄴ" 같은). 실험에서 실제로 나왔고 다음 턴에 그대로 따라 한다.
    private static final Pattern TRAILING_JAMO = Pattern.compile("(?m)(?<=[^\\s\\u3131-\\u318E])[\\u3131-\\u318E]+[ \\t]*$");

    private DirectVideoPracticeLoop() { }

    /** 모델 응답 하나를 숨은 칸과 배우에게 보일 본문으로 나눈 것. 없는 칸은 빈 문자열이다. */
    record Parsed(String design, String status, String message) { }

    static Parsed parse(String raw) {
        String text = raw == null ? "" : raw.strip();
        String design = first(DESIGN, text);
        String status = first(STATUS, text);
        String rest = STATUS.matcher(DESIGN.matcher(text).replaceAll("")).replaceAll("");
        Matcher coach = COACH.matcher(rest);
        String message = coach.find() ? coach.group(1) : rest;
        message = STRAY_TAG.matcher(message).replaceAll("");
        return new Parsed(design, status, TRAILING_JAMO.matcher(message).replaceAll("").strip());
    }

    /**
     * 이번 응답을 쓸 말. 앱이 한국어가 아닌 말로 요청했으면(Accept-Language, {@link OutputLanguage}) 그 말,
     * 앱이 한국어면 배우가 채팅이나 연습 메모에 쓴 말({@link #actorLanguage}). 한국어면 {@code null}.
     * 운영에서 영어로 상황을 적은 배우에게 한국어로 첫 질문을 하자 답하지 않고 떠났다.
     */
    static java.util.Locale replyLanguage(CoachSessionSnapshot session, String actorText) {
        return OutputLanguage.isKorean() ? actorLanguage(session, actorText) : OutputLanguage.current();
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
            } else {
                String status = loop == null ? "" : loop.path("statuses").path(coachIndex).asText("");
                if (!status.isBlank()) text = "<상태>" + status + "</상태>\n" + text;
            }
            history.add(new DirectVideoModel.Message("model", text));
            coachIndex++;
        }
        if (actorText != null) history.add(new DirectVideoModel.Message("user", actorText));
        return history;
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
        String next = first(DESIGN_NEXT, design);
        if (habit.isBlank() && next.isBlank()) return null;
        var quotes = com.acttub.actingapi.integration.llm.StructuredJson.MAPPER.createArrayNode();
        String selfLine = null;
        String selfRef = null;
        // 배우가 자기 한 줄로 분류된 말을 남겼으면 그것이 우선이다. 마무리1 직후의 답은 그것이 없을 때만 쓴다.
        String askedLine = null;
        String askedRef = null;
        String reason = null;
        String reasonRef = null;
        List<CoachTurnSnapshot> turns = session.turns();
        String lastAction = "";
        int coachIndex = 0;
        for (int i = 0; i < turns.size(); i++) {
            CoachTurnSnapshot turn = turns.get(i);
            if ("ai".equals(turn.role())) {
                String status = loop.path("statuses").path(coachIndex++).asText("");
                lastAction = action(status);
                continue;
            }
            String text = turn.text() == null ? "" : turn.text().strip();
            if (text.isEmpty() || VAGUE.matcher(text).matches()
                    || com.acttub.actingapi.feature.coach.domain.ClosingIntent.isClosing(text)) continue;
            // 다음 코치 턴이 이 답을 "자기 한 줄"로 받았으면(배우가 청하기 전에 먼저 말한 경우) 그것도 자기 문장이다.
            String kind = statusField(loop.path("statuses").path(coachIndex).asText(""), "배우의 말");
            if (kind.startsWith("자기 한 줄")) {
                selfLine = text;
                selfRef = StructuredCoachEngine.turnId(session, i);
            } else if (lastAction.startsWith("마무리1") && askedLine == null && !request(kind, text)) {
                // 한 줄을 청한 자리에서 배우가 평가·방법을 청하거나 반박했으면 그 말은 한 줄이 아니다(SOMA-601).
                askedLine = text;
                askedRef = StructuredCoachEngine.turnId(session, i);
            } else if (lastAction.startsWith("파고들기")) {
                // 버릇이 언제·왜 나오는지에 대한 배우의 마지막 답.
                reason = text;
                reasonRef = StructuredCoachEngine.turnId(session, i);
            }
        }
        if (selfLine == null) {
            selfLine = askedLine;
            selfRef = askedRef;
        }
        if (selfLine != null) quotes.addObject().put("quote", selfLine).put("kind", "actor").put("source_ref", selfRef);
        if (reason != null) quotes.addObject().put("quote", reason).put("kind", "actor").put("source_ref", reasonRef);
        String title = habit.isBlank() ? null : shorten(habit, TITLE_MAX);
        // 마무리2의 상태 칸에 다시 정한 다음 테이크가 있으면 그것을 쓴다 — 배우가 그 버릇을 지키겠다고 했으면 설계의 "반대쪽"과 다르다.
        String closingNext = closingNextTake(loop.path("statuses"));
        if (!closingNext.isBlank()) next = closingNext;
        String nextTake = next.isBlank() ? null : next;
        var empty = com.acttub.actingapi.integration.llm.StructuredJson.MAPPER.createArrayNode();
        return new ConversationRepository.NewNote("v2", nextTake == null ? "observation" : "action", title, quotes,
                nextTake, empty, empty, empty, false, sourceRevision, null);
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

    /** 상태 줄에서 이번 응답이 한 일. 첫 턴(상태 없음)은 비추기다. */
    private static String action(String status) {
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
