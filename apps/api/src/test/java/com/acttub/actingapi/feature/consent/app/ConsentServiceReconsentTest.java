package com.acttub.actingapi.feature.consent.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.consent.domain.ConsentDocument;
import com.acttub.actingapi.feature.consent.domain.ConsentEntry;
import com.acttub.actingapi.feature.consent.domain.ConsentEvent;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 새 판은 발행 즉시 현재 판이고, 기존 회원 재동의만 reconsentFrom 까지 미룬다. */
class ConsentServiceReconsentTest {
    private static final Instant FROM = Instant.parse("2026-10-31T15:00:00Z");
    private static final UUID USER = UUID.randomUUID();

    private final ConsentDocument termsV1 = doc("terms", "v1");
    private final ConsentDocument termsV2 = doc("terms", "v2");
    private final ConsentRepository repository = mock(ConsentRepository.class);
    private final ReconsentSchedule schedule =
            (type, version) -> "terms".equals(type) && "v2".equals(version) ? FROM : null;

    private static ConsentDocument doc(String type, String version) {
        return new ConsentDocument(UUID.randomUUID(), type, version, type, "body", true, Instant.parse("2026-10-27T00:00:00Z"));
    }

    private ConsentService service(Instant now) {
        when(repository.listLatestDocuments()).thenReturn(List.of(termsV2));
        when(repository.findDocument(termsV1.id())).thenReturn(termsV1);
        when(repository.findDocument(termsV2.id())).thenReturn(termsV2);
        return new ConsentService(repository, List::of, Clock.fixed(now, ZoneOffset.UTC), schedule);
    }

    private void decided(ConsentDocument document) {
        when(repository.currentConsentsOf(USER)).thenReturn(List.of(
                new ConsentEvent(UUID.randomUUID(), USER, document.id(), "granted", Instant.parse("2026-09-01T00:00:00Z"))));
    }

    @Test
    @DisplayName("재동의 시각 전: v1에 동의한 기존 회원은 v2를 다시 묻지 않고 설정 화면에는 v1 결정이 보인다")
    void existingMemberIsNotAskedBeforeTheReconsentTime() {
        decided(termsV1);
        ConsentService service = service(FROM.minusSeconds(1));

        ConsentEntry entry = service.entryFor(USER, false);

        assertThat(entry.status()).isEqualTo(ConsentEntry.Status.ALLOWED);
        assertThat(service.pendingDocuments(USER)).isEmpty();
        assertThat(entry.documents()).singleElement().satisfies(decision -> {
            assertThat(decision.document().version()).isEqualTo("v1");
            assertThat(decision.currentDecision()).isNotNull();
        });
    }

    @Test
    @DisplayName("재동의 시각이 되면 같은 회원에게 v2 재동의가 뜬다")
    void existingMemberIsAskedFromTheReconsentTime() {
        decided(termsV1);

        ConsentService service = service(FROM);

        assertThat(service.entryFor(USER, false).status()).isEqualTo(ConsentEntry.Status.DECISION_REQUIRED);
        assertThat(service.pendingDocuments(USER)).singleElement()
                .satisfies(document -> assertThat(document.version()).isEqualTo("v2"));
    }

    @Test
    @DisplayName("재동의 시각 전에도 아직 약관에 결정이 없는 사람에게는 현재 판 v2를 묻는다")
    void aPersonWithNoDecisionIsAskedForTheCurrentVersionImmediately() {
        when(repository.currentConsentsOf(USER)).thenReturn(List.of());

        ConsentService service = service(FROM.minusSeconds(1));

        assertThat(service.pendingDocuments(USER)).singleElement()
                .satisfies(document -> assertThat(document.version()).isEqualTo("v2"));
    }

    @Test
    @DisplayName("재동의 시각 전에 v2에 동의한 사람은 v2 결정이 그대로 보인다")
    void aMemberWhoAlreadyDecidedV2KeepsIt() {
        decided(termsV2);

        ConsentService service = service(FROM.minusSeconds(1));

        assertThat(service.entryFor(USER, false).documents()).singleElement()
                .satisfies(decision -> assertThat(decision.document().version()).isEqualTo("v2"));
        assertThat(service.pendingDocuments(USER)).isEmpty();
    }
}
