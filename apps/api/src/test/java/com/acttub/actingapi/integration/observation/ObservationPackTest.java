package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ObservationPackTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void oldStoredPackDefaultsTimelineAndOmitsMissingSpeechOnSerialization() throws Exception {
        var old = mapper.readValue("""
                {"scene_summary":"장면", "observations":[], "uncertainties":[]}
                """, ObservationPack.class);
        assertThat(old.timeline()).isEmpty();
        assertThat(old.speech()).isNull();
        assertThat(mapper.valueToTree(old).has("speech")).isFalse();
    }

    @Test
    void newPackRoundTripsMeasuredFieldsUsingTheSpecifiedNames() throws Exception {
        var speech = SpeechFacts.calculate("가지 마", List.of(new SpeechFacts.Word("가지 마", 1, 4)));
        var pack = new ObservationPack("장면", "0:01에 말한다", speech, List.of(), List.of());
        var json = mapper.valueToTree(pack);
        assertThat(json.at("/speech/avg_syllables_per_sec").isNumber()).isTrue();
        assertThat(json.at("/speech/chunks/0/start_ms").asLong()).isEqualTo(1000);
        assertThat(json.at("/speech/chunks/0/end_ms").asLong()).isEqualTo(4000);
        assertThat(json.at("/speech/chunks/0/delta_pct").asInt()).isZero();
        // 전체 단어 시각은 새 video_record 전용 내부 재료이며 기존 JSON 계약에는 추가하지 않는다.
        assertThat(json.path("speech").has("words")).isFalse();
        var restored = mapper.treeToValue(json, ObservationPack.class);
        assertThat(restored).usingRecursiveComparison().ignoringFields("speech.words").isEqualTo(pack);
        assertThat(restored.speech().words()).isEmpty();
        assertThat(mapper.<com.fasterxml.jackson.databind.JsonNode>valueToTree(restored)).isEqualTo(json);
    }
}
