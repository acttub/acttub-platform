package com.acttub.actingapi.feature.consent.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class ConsentEntryTest {

    private static ConsentDocument document(String type, boolean required) {
        return new ConsentDocument(UUID.randomUUID(), type, "v1", type, "", required, Instant.EPOCH);
    }

    private static ConsentEvent granted(ConsentDocument document) {
        return new ConsentEvent(UUID.randomUUID(), UUID.randomUUID(), document.id(), "granted", Instant.EPOCH);
    }

    @Test
    void 고품질_목소리_동의는_켤_때_받으므로_미결정이어도_진입을_막지_않는다() {
        ConsentDocument terms = document("terms", true);
        ConsentDocument cloudVoice = document("cloud_voice", false);

        ConsentEntry entry = ConsentEntry.evaluate(List.of(terms, cloudVoice), List.of(granted(terms)));

        assertThat(entry.status()).isEqualTo(ConsentEntry.Status.ALLOWED);
        assertThat(entry.undecidedDocuments()).isEmpty();
        // 설정의 동의 목록에서 거둘 수 있도록 전체 목록에는 남는다
        assertThat(entry.documents()).extracting(d -> d.document().type()).contains("cloud_voice");
    }

    @Test
    void 다른_선택_동의가_미결정이면_여전히_진입에서_묻는다() {
        ConsentDocument terms = document("terms", true);
        ConsentDocument retention = document("retention", false);

        ConsentEntry entry = ConsentEntry.evaluate(List.of(terms, retention), List.of(granted(terms)));

        assertThat(entry.status()).isEqualTo(ConsentEntry.Status.DECISION_REQUIRED);
        assertThat(entry.undecidedDocuments()).extracting(d -> d.document().type()).containsExactly("retention");
    }
}
