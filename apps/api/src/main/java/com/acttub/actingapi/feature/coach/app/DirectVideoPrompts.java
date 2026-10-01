package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.stream.Collectors;
import com.acttub.actingapi.integration.llm.StructuredJson;

/** Only tasks selected by application routing are sent to the coach. */
final class DirectVideoPrompts {
    private DirectVideoPrompts() {}
    static String common() { return resource("common"); }
    static String classifier() { return resource("classifier"); }
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
        String base = practiceLoop();
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
    static String forRoutes(List<DirectVideoRoute> routes) {
        return common() + "\n\n" + routes.stream().map(route -> resource(route.id))
                .collect(Collectors.joining("\n\n"));
    }
    private static String resource(String name) {
        return StructuredJson.textResource("/coaching/direct-video/" + name + ".txt").strip();
    }
}
