package com.acttub.actingapi.feature.coach.app;

import java.util.List;
import java.util.stream.Collectors;
import com.acttub.actingapi.integration.llm.StructuredJson;

/** Only tasks selected by application routing are sent to the coach. */
final class DirectVideoPrompts {
    private DirectVideoPrompts() {}
    static String common() { return resource("common"); }
    static String classifier() { return resource("classifier"); }
    /** 분류·과제 조립 없이 대화 전체를 끄는 연습 루프 프롬프트. */
    static String practiceLoop() { return resource("practice-loop"); }
    static String forRoutes(List<DirectVideoRoute> routes) {
        return common() + "\n\n" + routes.stream().map(route -> resource(route.id))
                .collect(Collectors.joining("\n\n"));
    }
    private static String resource(String name) {
        return StructuredJson.textResource("/coaching/direct-video/" + name + ".txt").strip();
    }
}
