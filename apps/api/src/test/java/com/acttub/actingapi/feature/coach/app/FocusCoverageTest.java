package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class FocusCoverageTest {
    ObjectNode record() { return (ObjectNode) StructuredJson.resource("/coaching/record.json").deepCopy(); }
    ObjectNode focus(String... refs) {
        ObjectNode f = StructuredJson.MAPPER.createObjectNode().put("label", "말의 전달")
                .put("scope", "whole_video").put("pattern", "recurring").putNull("utterance_ref");
        var ids = f.putArray("evidence_refs");
        for (String ref : refs) ids.add(ref);
        return f;
    }
    @Test void separateEarlyLateObservationsOrLongObservationCanSupportWholeVideo() {
        var record = record(); var view = new CoachRecordLookup().initial(record);
        assertThatCode(() -> FocusCoverage.validate(focus("e1", "e5"), record, view)).doesNotThrowAnyException();
        assertThatCode(() -> FocusCoverage.validate(focus("e8"), record, view)).doesNotThrowAnyException();
    }
    @Test void severalIdsInOneMomentAndTranscriptAloneCannotSupportWholeVideo() {
        var record = record(); var view = new CoachRecordLookup().initial(record);
        assertThatThrownBy(() -> FocusCoverage.validate(focus("e1", "e2"), record, view)).hasMessageContaining("early and late");
        assertThatThrownBy(() -> FocusCoverage.validate(focus("u1"), record, view)).hasMessageContaining("early and late");
    }
    @Test void missingAnalysisOrUndeliveredLimitationsPreventGlobalClaim() {
        var record = record(); var view = new CoachRecordLookup().initial(record);
        ((ObjectNode) record.path("processing")).put("status", "partial");
        assertThatThrownBy(() -> FocusCoverage.validate(focus("e8"), record, view)).hasMessageContaining("missing ranges");
        ((ObjectNode) record.path("processing")).put("status", "ready");
        view.putArray("source_catalog");
        assertThatThrownBy(() -> FocusCoverage.validate(focus("e8"), record, view)).hasMessageContaining("lookup more");
    }
    @Test void legacyAndLocalFocusRemainReadable() {
        var record = record(); var view = new CoachRecordLookup().initial(record);
        var legacy = focus("e1"); legacy.remove("scope"); legacy.remove("pattern");
        StructuredJson.validate("focus", legacy);
        assertThatCode(() -> FocusCoverage.validate(legacy, record, view)).doesNotThrowAnyException();
        assertThatCode(() -> FocusCoverage.validate(focus("e1").put("scope", "local").put("pattern", "isolated"), record, view)).doesNotThrowAnyException();
    }
}
