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

    private static final List<String> SOUND_LINES = List.of("소리 쉬는 곳", "소리 말끝", "소리 크기", "소리 강조");
    private static final String SOUND_ORDER = "소리 쉬는 곳·말끝·크기·강조 네 줄";

    /**
     * 연습마다 {@code <설계>}의 소리 네 칸(쉬는 곳·말끝·크기·강조) 순서를 섞은 연습 루프 프롬프트.
     *
     * <p>모델은 맨 위 칸을 버릇으로 고르는 쪽으로 쏠린다(실험: 순서를 고정하면 맨 위 칸이 73%).
     * 같은 연습은 매 턴 기록을 다시 보내므로 연습 id로 순서를 고정한다. 말 빠르기 칸은 늘 마지막이다.
     * 칸을 다 찾지 못하면(프롬프트가 바뀐 경우) 섞지 않고 그대로 돌려준다.
     */
    static String practiceLoop(UUID practiceId) {
        String base = practiceLoop();
        if (practiceId == null) return base;
        var lines = new ArrayList<>(List.of(base.split("\n", -1)));
        var at = new ArrayList<Integer>();
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            if (SOUND_LINES.stream().anyMatch(name -> line.startsWith(name + ": ["))) at.add(i);
        }
        if (at.size() != SOUND_LINES.size()) return base;
        var picked = new ArrayList<String>();
        for (int i : at) picked.add(lines.get(i));
        Collections.shuffle(picked, new Random(practiceId.getMostSignificantBits() ^ practiceId.getLeastSignificantBits()));
        for (int k = 0; k < at.size(); k++) lines.set(at.get(k), picked.get(k));
        String order = picked.stream().map(line -> line.substring("소리 ".length(), line.indexOf(": [")))
                .collect(Collectors.joining("·"));
        return String.join("\n", lines).replace(SOUND_ORDER, "소리 " + order + " 네 줄");
    }
    static String forRoutes(List<DirectVideoRoute> routes) {
        return common() + "\n\n" + routes.stream().map(route -> resource(route.id))
                .collect(Collectors.joining("\n\n"));
    }
    private static String resource(String name) {
        return StructuredJson.textResource("/coaching/direct-video/" + name + ".txt").strip();
    }
}
