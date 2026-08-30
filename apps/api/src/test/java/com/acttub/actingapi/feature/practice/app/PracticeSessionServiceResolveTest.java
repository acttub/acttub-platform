package com.acttub.actingapi.feature.practice.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.domain.AnalysisStatus;
import com.acttub.actingapi.feature.practice.domain.PracticeSession;
import com.acttub.actingapi.feature.practice.domain.ResolutionSelfReport;
import com.acttub.actingapi.feature.practice.domain.SessionDetail;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 자기보고 저장 규칙. 저장소는 기록만 하는 가짜다 — SQL 은 통합 테스트의 몫이다. */
class PracticeSessionServiceResolveTest {

    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID SESSION = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final Instant NOW = Instant.parse("2026-08-30T05:00:00Z");

    @Test
    @DisplayName("값과 다듬은 메모, 지금 시각을 저장소에 넘긴다")
    void storesValueTrimmedNoteAndNow() {
        RecordingRepository repository = new RecordingRepository(true);

        service(repository).resolve(USER, SESSION, ResolutionSelfReport.PARTLY, "  아직 첫 줄은 빨라져  ");

        assertThat(repository.selfReport).isEqualTo("partly");
        assertThat(repository.note).isEqualTo("아직 첫 줄은 빨라져");
        assertThat(repository.now).isEqualTo(OffsetDateTime.ofInstant(NOW, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("빈 메모는 null 로 저장한다 — 공백 한 칸을 배우의 말로 남기지 않는다")
    void blankNoteBecomesNull() {
        RecordingRepository repository = new RecordingRepository(true);

        service(repository).resolve(USER, SESSION, ResolutionSelfReport.SAME, "   ");
        assertThat(repository.note).isNull();

        service(repository).resolve(USER, SESSION, ResolutionSelfReport.SAME, null);
        assertThat(repository.note).isNull();
    }

    @Test
    @DisplayName("메모가 200자를 넘으면 422 다")
    void rejectsOverlongNote() {
        RecordingRepository repository = new RecordingRepository(true);

        assertThatThrownBy(() -> service(repository)
                .resolve(USER, SESSION, ResolutionSelfReport.RESOLVED, "가".repeat(201)))
                .isInstanceOf(ApiException.class)
                .hasMessage("resolution_note_too_long")
                .extracting("status").isEqualTo(422);
        assertThat(repository.selfReport).isNull();
    }

    @Test
    @DisplayName("없거나 남의 것이거나 숨긴 연습이면 404 다")
    void missingSessionIs404() {
        assertThatThrownBy(() -> service(new RecordingRepository(false))
                .resolve(USER, SESSION, ResolutionSelfReport.RESOLVED, null))
                .isInstanceOf(ApiException.class)
                .hasMessage("practice_session_not_found")
                .extracting("status").isEqualTo(404);
    }

    private static PracticeSessionService service(PracticeSessionRepository repository) {
        return new PracticeSessionService(
                null, repository, null, Clock.fixed(NOW, ZoneOffset.UTC), null);
    }

    private static final class RecordingRepository implements PracticeSessionRepository {
        private final boolean found;
        String selfReport;
        String note;
        OffsetDateTime now;

        RecordingRepository(boolean found) {
            this.found = found;
        }

        @Override
        public boolean recordResolution(
                UUID userId, UUID sessionId, String selfReport, String note, OffsetDateTime now) {
            if (!found) {
                return false;
            }
            this.selfReport = selfReport;
            this.note = note;
            this.now = now;
            return true;
        }

        @Override
        public boolean uploadExists(UUID userId, UUID uploadId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public PracticeSession find(UUID userId, UUID sessionId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public List<PracticeSession> list(UUID userId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public AnalysisStatus status(UUID userId, UUID sessionId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public UUID parentOf(UUID userId, UUID sessionId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public SessionDetail detail(UUID userId, UUID sessionId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean hide(UUID userId, UUID sessionId, OffsetDateTime now) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean resumeFailedOperation(UUID userId, UUID operationId, OffsetDateTime now) {
            throw new UnsupportedOperationException();
        }
    }
}
