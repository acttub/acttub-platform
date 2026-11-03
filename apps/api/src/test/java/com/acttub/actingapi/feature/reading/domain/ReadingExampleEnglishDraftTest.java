package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * V89 의 영어 예시 대본 3편(SOMA-1033) — 미리 나눈 줄이 원문과 맞고, 원문이 앱 내장 목록(sample.ts)과 글자 그대로 같은지 본다.
 * DB 없이 마이그레이션 글을 읽는다.
 */
class ReadingExampleEnglishDraftTest {
    private static final Pattern ROW = Pattern.compile("'([a-z-]+)', '((?:[^']|'')*)', '((?:[^']|'')*)', (\\d+), true, 'en',"
            + "\\s*\\$raw\\$(.*?)\\$raw\\$,\\s*\\$draft\\$(.*?)\\$draft\\$::jsonb", Pattern.DOTALL);

    @Test
    @DisplayName("V89: 3편 모두 제목이 원문 첫 줄이고, 대본 저장 규칙을 통과하며, 한글이 없다")
    void everyEnglishExampleIsSavable() throws IOException {
        Map<String, ReadingExample> examples = examples();
        assertThat(examples.keySet()).containsExactly("rooftop-en", "cafe-en", "mia-en");
        for (ReadingExample example : examples.values()) {
            assertThat(example.rawText().split("\n")[0]).isEqualTo(example.title());
            assertThat(ScriptRules.check(example.draft())).as(example.id()).isNull();
            assertThat(example.rawText()).as(example.id()).doesNotContainPattern("[가-힣]");
            assertThat(example.preview()).hasSize(5);
        }
        assertThat(examples.get("cafe-en").summary()).isEqualTo("Hannah · Josh · 2-person scene");
        assertThat(examples.get("rooftop-en").characters()).containsExactly("Ellie", "Theo");
    }

    @Test
    @DisplayName("V89 장면 둘: 줄마다 원문의 「이름: 대사」·지문과 같다")
    void scenesMatchTheirRawText() throws IOException {
        for (String id : List.of("rooftop-en", "cafe-en")) {
            ReadingExample example = examples().get(id);
            assertThat(rendered(example)).as(id).isEqualTo(bodyLines(example.rawText()));
            assertThat(example.dialogueCount()).as(id).isEqualTo(15);
        }
    }

    @Test
    @DisplayName("V89 mia-en: 지문 1줄 + 문장 7개, 서버의 독백 문장 나누기와 같다")
    void monologueMatchesItsRawText() throws IOException {
        ReadingExample mia = examples().get("mia-en");
        List<String> body = bodyLines(mia.rawText());
        assertThat(body).hasSize(2);
        assertThat(mia.lines().getFirst()).isEqualTo(new ReadingExample.Line("direction", null, body.getFirst()));
        assertThat(mia.lines().subList(1, mia.lines().size())).extracting(ReadingExample.Line::text)
                .isEqualTo(Monologue.sentences(body.get(1)));
        assertThat(mia.draft().unnamedCast()).isFalse();
    }

    @Test
    @DisplayName("V89 원문은 앱 내장 영어 예시(sample.ts *_EN)와 글자 그대로 같다 — 같은 글 판정이 해시로 된다")
    void rawTextMatchesTheApp() throws IOException {
        String app = Files.readString(Path.of("../mobile/lib/reading/sample.ts"), StandardCharsets.UTF_8);
        for (ReadingExample example : examples().values()) {
            assertThat(app).as(example.id()).contains("`" + example.rawText() + "`");
        }
    }

    private static List<String> bodyLines(String rawText) {
        List<String> lines = new ArrayList<>();
        String[] all = rawText.split("\n");
        for (int index = 1; index < all.length; index++) {
            if (!all[index].isBlank()) {
                lines.add(all[index].strip());
            }
        }
        return lines;
    }

    private static List<String> rendered(ReadingExample example) {
        return example.lines().stream()
                .map(line -> line.character() == null ? line.text() : example.characters().get(line.character()) + ": " + line.text())
                .toList();
    }

    private static Map<String, ReadingExample> examples() throws IOException {
        String sql;
        try (InputStream in = ReadingExampleEnglishDraftTest.class.getResourceAsStream("/db/migration/V89__reading_examples_english.sql")) {
            assertThat(in).isNotNull();
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        ObjectMapper mapper = new ObjectMapper();
        Map<String, ReadingExample> examples = new LinkedHashMap<>();
        Matcher matcher = ROW.matcher(sql);
        while (matcher.find()) {
            JsonNode draft = mapper.readTree(matcher.group(6));
            List<String> characters = new ArrayList<>();
            draft.path("characters").forEach(name -> characters.add(name.textValue()));
            List<ReadingExample.Line> lines = new ArrayList<>();
            draft.path("lines").forEach(line -> lines.add(new ReadingExample.Line(line.path("kind").textValue(),
                    line.path("character").isNull() ? null : line.path("character").intValue(), line.path("text").textValue())));
            examples.put(matcher.group(1), new ReadingExample(matcher.group(1), matcher.group(2).replace("''", "'"),
                    matcher.group(3).replace("''", "'"), matcher.group(5), characters, lines));
        }
        return examples;
    }
}
