package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.stream.Collectors;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.DirectVideoModel;

/** Only tasks selected by application routing are sent to the coach. */
final class DirectVideoPrompts {
    private DirectVideoPrompts() {}
    static String common() { return resource("common"); }
    static String classifier() { return resource("classifier"); }
    static String withAudioFacts(String instruction, DirectVideoModel.Video video) {
        return video != null && Boolean.FALSE.equals(video.hasAudioTrack())
                ? resource("no-audio") + "\n\n" + instruction : instruction;
    }
    /** 분류·과제 조립 없이 대화 전체를 끄는 연습 루프 프롬프트. */
    static String practiceLoop() { return resource("practice-loop"); }

    /** {@code <설계>}에서 버릇 후보가 되는 네 칸. 모델은 맨 위 칸을 고르는 쪽으로 쏠리므로 연습마다 순서를 섞는다. */
    private static final List<String> HABIT_LINES = List.of("감정의 변화", "상대와 주고받기", "원하는 것과 행동", "몸·시선·표정");

    /**
     * 연습마다 {@code <설계>}의 버릇 후보 네 칸 순서를 섞은 연습 루프 프롬프트.
     *
     * <p>순서를 고정하면 모델이 맨 위 칸을 버릇으로 고르는 쪽으로 쏠린다(실험: 맨 위 칸 73%).
     * 같은 연습은 매 턴 기록을 다시 보내므로 연습 id로 순서를 고정한다.
     * 칸을 다 찾지 못하면(프롬프트가 바뀐 경우) 섞지 않고 그대로 돌려준다.
     */
    static String practiceLoop(UUID practiceId) {
        return practiceLoop(practiceId, null);
    }

    /** 영어판 연습 루프. 숨은 칸 이름·할 일 이름은 한국어판과 같다(서버가 읽는다). */
    static String practiceLoopEnglish() { return resource("practice-loop.en"); }

    /**
     * 답할 말에 맞는 연습 루프 프롬프트. 말은 분류(코드)가 정하고 프롬프트는 그 말로 쓰인 것을 고른다.
     * 한국어(null 포함)는 한국어판 그대로, 그 밖의 말은 영어판을 쓴다. 영어가 아닌 말(일본어 등)은
     * 영어판 끝에 그 말로 답하라는 {@link com.acttub.actingapi.platform.web.OutputLanguage} 지시를 붙인다.
     */
    static String practiceLoop(UUID practiceId, java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        String base = korean ? practiceLoop() : practiceLoopEnglish();
        if (!korean && !"en".equals(language.getLanguage())) {
            base = base + com.acttub.actingapi.platform.web.OutputLanguage.directiveFor(language);
        }
        if (practiceId == null) return base;
        var lines = new ArrayList<>(List.of(base.split("\n", -1)));
        var at = new ArrayList<Integer>();
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            if (HABIT_LINES.stream().anyMatch(name -> line.startsWith(name + ": ["))) at.add(i);
        }
        if (at.size() != HABIT_LINES.size()) return base;
        var picked = new ArrayList<String>();
        for (int i : at) picked.add(lines.get(i));
        Collections.shuffle(picked, new Random(practiceId.getMostSignificantBits() ^ practiceId.getLeastSignificantBits()));
        for (int k = 0; k < at.size(); k++) lines.set(at.get(k), picked.get(k));
        return String.join("\n", lines);
    }
    /** 긴 코치 말을 줄이기만 하는 지시. 한국어가 아니면 그 말로 줄이라는 말을 덧붙인다. */
    static String practiceLoopShorten(java.util.Locale language) {
        String base = resource("practice-loop-shorten");
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return korean ? base : base + com.acttub.actingapi.platform.web.OutputLanguage.directiveFor(language);
    }

    /** 연습 루프 둘째 응답부터 배우의 말 종류를 묻는 분류 지시. 출력은 {@code {"signals":[...]}}. */
    static String practiceLoopClassifier() { return resource("practice-loop-classify"); }

    /** 연습 루프 둘째 응답부터의 공통 지시(첫 응답 지시·분기 표 없음). 할 일 칸은 {@link #practiceLoopTask}가 붙인다. */
    static String practiceLoopTurn() { return resource("practice-loop-turn"); }

    static String practiceLoopTurnEnglish() { return resource("practice-loop-turn.en"); }

    /** 답할 말에 맞는 둘째 응답부터의 공통 지시. 말을 고르는 규칙은 {@link #practiceLoop(UUID, java.util.Locale)}와 같다. */
    static String practiceLoopTurn(java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        String base = korean ? practiceLoopTurn() : practiceLoopTurnEnglish();
        if (!korean && !"en".equals(language.getLanguage())) {
            base = base + com.acttub.actingapi.platform.web.OutputLanguage.directiveFor(language);
        }
        return base;
    }

    /** 할 일 이름과 상황별 프롬프트 파일. 할 일마다 파일 하나다({@code coaching/direct-video/tasks/<말>/<id>.txt}). */
    private static final java.util.Map<String, String> TASK_FILES = java.util.Map.ofEntries(
            java.util.Map.entry(PracticeLoopRouter.WANT, "want"),
            java.util.Map.entry(PracticeLoopRouter.GAP, "gap"),
            java.util.Map.entry(PracticeLoopRouter.FIND, "find"),
            java.util.Map.entry(PracticeLoopRouter.EASY, "easy"),
            java.util.Map.entry(PracticeLoopRouter.REASK, "reask"),
            java.util.Map.entry(PracticeLoopRouter.PROPOSE, "propose"),
            java.util.Map.entry(PracticeLoopRouter.WRAP_UP, "wrap-up"),
            java.util.Map.entry("짚어주기", "point-out"),
            java.util.Map.entry("짚어주기(다른 쪽)", "point-out-other"),
            java.util.Map.entry("내려놓기", "let-go"),
            java.util.Map.entry("답하기", "answer"));

    /**
     * 할 일 하나의 상황별 프롬프트. 한국어는 {@code tasks/ko}, 그 밖의 말은 {@code tasks/en}에서 읽는다.
     * 파일이 없는 할 일이면 예외 — 서버가 정한 할 일과 파일이 어긋난 것이다.
     */
    /** 첫 응답 <설계>의 근본 문제 칸(번호나 이름)으로 고르는 "이 문제를 푸는 길" 파일. */
    private static final java.util.List<String[]> ROOTS = java.util.List.of(
            new String[] {"1", "집중", "focus"}, new String[] {"2", "목적", "purpose"}, new String[] {"3", "캐릭터", "character"},
            new String[] {"4", "상황", "situation"}, new String[] {"5", "관계", "relationship"});

    /** 근본 문제 칸을 읽어 그 길을 돌려준다. 칸이 비었거나 모르는 값이면 빈 문자열(예전 대화). */
    static String practiceLoopRoot(String rootField, java.util.Locale language) {
        if (rootField == null || rootField.isBlank()) return "";
        String value = rootField.strip();
        boolean korean = language == null || "ko".equals(language.getLanguage());
        for (String[] root : ROOTS) {
            if (value.startsWith(root[0]) || value.contains(root[1])) {
                return resource("roots/" + (korean ? "ko" : "en") + "/" + root[2]);
            }
        }
        return "";
    }

    static String practiceLoopTask(String doing, java.util.Locale language) {
        String id = TASK_FILES.get(doing);
        if (id == null) throw new IllegalStateException("practice loop task is missing: " + doing);
        boolean korean = language == null || "ko".equals(language.getLanguage());
        return resource("tasks/" + (korean ? "ko" : "en") + "/" + id);
    }

    /** 성격 id 로 덧붙일 글. 기본 성격·모르는 id·한국어가 아닌 말이면 빈 문자열(SOMA-622). */
    static String persona(String id, java.util.Locale language) {
        boolean korean = language == null || "ko".equals(language.getLanguage());
        if (!korean || !"b1".equals(id)) return "";
        return resource("personas/" + id);
    }

    /** 성격을 받은 대화에서 줄이기가 말투를 기본 말투로 되돌리지 않게 하는 한 줄. */
    static String personaShortenNote(String id, java.util.Locale language) {
        return persona(id, language).isEmpty() ? ""
                : "\n- 말투는 원래 말의 말투를 그대로 둔다. 원래 말이 \"~해요.\"로 방향을 줬으면 \"~해 봐도 좋아요\"로 바꾸지 않는다. 쿠션어나 칭찬을 더하지 않는다.";
    }

    static String forRoutes(List<DirectVideoRoute> routes) {
        return common() + "\n\n" + routes.stream().map(route -> resource(route.id))
                .collect(Collectors.joining("\n\n"));
    }
    private static String resource(String name) {
        return StructuredJson.textResource("/coaching/direct-video/" + name + ".txt").strip();
    }
}
