package com.acttub.actingapi.feature.reading.adapter.pron;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.feature.reading.domain.PronunciationRules;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.LineInput;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/**
 * 고정한 채점 서비스 응답으로 만든 보고서가 바뀌지 않는다(SOMA-1171). 짚는 기준을 채점 서비스에서 api 로 옮길 때 보고서가 같은지
 * 보려고 옮기기 전에 넣었다.
 *
 * <p>응답({@code pron/pron-responses.json})은 짚는 기준을 옮기기 전 채점 서비스(apps/pron)가 맥 합성 음성 녹음에 낸 것이다 —
 * 대본대로 읽기, 소리 바꿔 읽기, 허용하는 변이(ㄹ→ㅎ·ㅕ→ㅛ·ㄲ→ㄸ·ㅡ→ㅔ), 이중 모음, 울림소리 뒤 ㅎ, 대본 밖, 숫자, 말끝 '-고요'.
 * 기대 보고서({@code pron/reports.json})는 옮기기 전 코드가 만든 것이다. 규칙을 일부러 바꿨을 때만
 * {@code UPDATE_PRON_REPORTS=1 ./gradlew test --tests '*PronunciationReportFixtureTest*'} 로 다시 쓰고(갱신하면 일부러 실패한다)
 * diff 를 확인한다.
 */
class PronunciationReportFixtureTest {
    private static final Path RESPONSES = Path.of("src/test/resources/pron/pron-responses.json");
    private static final Path REPORTS = Path.of("src/test/resources/pron/reports.json");
    private final ObjectMapper mapper = JsonMapper.builder().enable(SerializationFeature.INDENT_OUTPUT).build();

    @Test
    void 고정한_채점_서비스_응답으로_만든_보고서가_그대로다() throws IOException {
        ObjectNode actual = reports(mapper.readTree(RESPONSES.toFile()));
        if (System.getenv("UPDATE_PRON_REPORTS") != null) {
            Files.writeString(REPORTS, mapper.writeValueAsString(actual) + "\n");
            fail("pron/reports.json 을 다시 썼다. diff 를 확인하고 UPDATE_PRON_REPORTS 없이 다시 돌린다");
        }
        JsonNode expected = mapper.readTree(REPORTS.toFile());
        assertThat(actual.propertyNames()).containsExactlyElementsOf(expected.propertyNames());
        for (String session : expected.propertyNames()) {
            assertThat(actual.get(session)).as(session).isEqualTo(expected.get(session));
        }
    }

    @Test
    void 짚음을_보내지_않는_새_채점_서비스의_응답으로도_같은_보고서다() throws IOException {
        JsonNode sessions = mapper.readTree(RESPONSES.toFile());
        for (JsonNode session : sessions) {
            for (JsonNode line : session.path("lines")) {
                ObjectNode response = (ObjectNode) line.path("response");
                response.remove("threshold");
                for (JsonNode word : response.path("words")) {
                    for (JsonNode phone : word.path("phones")) {
                        ((ObjectNode) phone).remove("flagged");
                    }
                }
            }
        }
        assertThat(reports(sessions)).isEqualTo(mapper.readTree(REPORTS.toFile()));
    }

    /** 회차마다 줄 응답을 api 가 읽는 길(HttpPronunciationScorer.parse)로 읽어 보고서를 만든다. */
    private ObjectNode reports(JsonNode sessions) {
        ObjectNode out = mapper.createObjectNode();
        for (JsonNode session : sessions) {
            List<LineInput> inputs = new ArrayList<>();
            for (JsonNode line : session.path("lines")) {
                inputs.add(new LineInput(line.path("lineNo").asInt(), line.path("scriptText").asString(),
                        line.path("transcript").asString(), HttpPronunciationScorer.parse(line.path("response")).line()));
            }
            out.set(session.path("session").asString(), mapper.valueToTree(PronunciationRules.build(inputs)));
        }
        return out;
    }
}
