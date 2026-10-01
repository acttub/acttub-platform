package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.*;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

class PracticeNoteTest {
    @Test void legacyReportRemainsIdentical() {
        JsonNode legacy = StructuredJson.parse("{\"report_type\":\"analysis\",\"title\":\"예전 노트\"}");
        assertThat(PracticeNote.publicView(legacy)).isSameAs(legacy);
    }
}
