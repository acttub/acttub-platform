package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import com.acttub.actingapi.integration.llm.StructuredJson;
import org.junit.jupiter.api.Test;

class SingleUtteranceFocusTest {
    @Test void theOnlyUtteranceCanSupportWholeSceneAnalysisButNotWholeVideoDelivery() {
        var record = StructuredJson.resource("/coaching/record.json");
        var view = new CoachRecordLookup().initial(record);
        var focus = StructuredJson.MAPPER.createObjectNode().put("scope", "whole_video")
                .put("pattern", "isolated").put("basis", "scene");
        focus.putArray("evidence_refs").add("u1");
        assertThatCode(() -> FocusCoverage.validate(focus, record, view)).doesNotThrowAnyException();
        focus.put("basis", "delivery");
        assertThatThrownBy(() -> FocusCoverage.validate(focus, record, view)).hasMessageContaining("isolated");
    }
}
