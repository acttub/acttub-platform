package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class StoredObservationPackTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode json(String raw) throws Exception {
        return JSON.readTree(raw);
    }

    @Test
    void storedVideoRecordIsReturnedAsIsAndAnUnknownVersionIsRejected() throws Exception {
        JsonNode record = json("{\"schema_version\":\"acttub.video_record.v1\",\"segments\":[]}");

        assertThat(StoredObservationPack.read(record, null, null)).isSameAs(record);
        assertThatThrownBy(() -> StoredObservationPack.read(json("{\"schema_version\":\"acttub.other.v9\"}"), null, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("unsupported stored observation version");
    }

    @Test
    void legacySeparateColumnsAreJoinedAndNonArraysBecomeEmpty() throws Exception {
        JsonNode joined = StoredObservationPack.read(null, json("[{\"quote\":\"가지 마\"}]"), json("{\"not\":\"array\"}"));
        JsonNode emptyRaw = StoredObservationPack.read(json("[]"), json("[{\"quote\":\"열지 마\"}]"), null);

        assertThat(joined).isEqualTo(json("{\"observations\":[{\"quote\":\"가지 마\"}],\"uncertainties\":[]}"));
        assertThat(emptyRaw).isEqualTo(json("{\"observations\":[{\"quote\":\"열지 마\"}],\"uncertainties\":[]}"));
    }
}
