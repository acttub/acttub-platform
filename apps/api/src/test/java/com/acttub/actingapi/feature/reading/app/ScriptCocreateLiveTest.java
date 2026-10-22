package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import com.acttub.actingapi.feature.reading.adapter.gen.GeminiScriptCocreateModel;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateService.Request;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateService.View;
import com.acttub.actingapi.feature.reading.domain.CocreateRules.Experience;
import com.acttub.actingapi.feature.reading.domain.CocreatedScript;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * 찍을 대사 같이 만들기를 실제 Gemini 로 세 번 만든다 — 입문 1분 독백, 입시 독백, 2인 장면. 명시적으로 켤 때만 돈다.
 * 결과는 {@code build/sample-scripts/} 에 글로 남긴다(검토용). 저장소는 메모리 가짜다.
 */
@EnabledIfEnvironmentVariable(named = "ACTTUB_SAMPLE_SCRIPT_LIVE_TEST", matches = "1")
@EnabledIfEnvironmentVariable(named = "GEMINI_API_KEY", matches = ".+")
class ScriptCocreateLiveTest {

    @Test
    void generatesThreeSamples() throws IOException {
        String model = System.getenv().getOrDefault("ACTTUB_SAMPLE_SCRIPT_MODEL", "gemini-4-argon");
        try (Client client = Client.builder().apiKey(System.getenv("GEMINI_API_KEY")).build()) {
            ScriptCocreateService service = new ScriptCocreateService(new ScriptCocreateServiceTest.MemoryRepository(),
                    new GeminiScriptCocreateModel(client, model), mock(ScriptService.class), new ObjectMapper(),
                    Clock.systemUTC(), bound -> ThreadLocalRandom.current().nextInt(bound));
            UUID user = UUID.randomUUID();
            write("1-beginner-monologue", service.generate(user, UUID.randomUUID(), new Request(Experience.BEGINNER, 24, "female",
                    "hobby", "서운함", "친구가 내 생일을 잊었어요", null, 1, 1)));
            write("2-exam-monologue", service.generate(user, UUID.randomUUID(), new Request(Experience.EXAM, 19, "male",
                    "audition", "분노", "아버지가 내 원서를 몰래 버렸어요", "끝까지 소리 지르지 않고 참았으면 좋겠어요", 1, 1)));
            write("3-two-person", service.generate(user, UUID.randomUUID(), new Request(Experience.BEGINNER, 27, "female",
                    "hobby", "긴장", "오랜만의 재회", null, 2, 1)));
        }
    }

    private static void write(String name, View view) throws IOException {
        StringBuilder out = new StringBuilder();
        CocreatedScript script = view.script();
        out.append(script.title()).append(" · ").append(script.scene()).append(" · 약 ").append(view.estimatedSeconds())
                .append("초 · ").append(view.emotion()).append(" / ").append(view.situation()).append('\n');
        for (CocreatedScript.Line line : script.lines()) {
            out.append(switch (line.kind()) {
                case "dialogue" -> line.character() + ": " + line.text();
                case "direction" -> "(" + line.text() + ")";
                default -> "[" + line.text() + "]";
            }).append('\n');
        }
        Path dir = Path.of("build/sample-scripts");
        Files.createDirectories(dir);
        Files.writeString(dir.resolve(name + ".txt"), out);
        assertThat(script.lines()).isNotEmpty();
    }
}
