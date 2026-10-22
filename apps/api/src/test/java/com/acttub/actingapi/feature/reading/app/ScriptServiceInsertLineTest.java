package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptRepository.LineEditOutcome;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 줄 아래에 추가(SOMA-816) — 저장소의 결과를 사유 코드로 옮기는 규칙. */
class ScriptServiceInsertLineTest {

    private final ScriptRepository scripts = mock(ScriptRepository.class);
    private final ScriptService service = new ScriptService(scripts, mock(ReadingRecordingCleanup.class), null, Clock.systemUTC());
    private final UUID user = UUID.randomUUID();
    private final UUID script = UUID.randomUUID();
    private final UUID line = UUID.randomUUID();
    private final UUID character = UUID.randomUUID();

    @Test
    @DisplayName("없는 대본이면 404 script_not_found")
    void missingScriptIsNotFound() {
        when(scripts.insertLineAfter(user, script, line, "direction", null, "x")).thenReturn(null);
        assertThatThrownBy(() -> service.insertLineAfter(user, script, line, "direction", null, "x"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("script_not_found"));
    }

    @Test
    @DisplayName("없는 줄은 404 line_not_found, 배역 규칙 위반은 422 invalid_line")
    void lineOutcomesBecomeReasonCodes() {
        when(scripts.insertLineAfter(user, script, line, "dialogue", character, "x")).thenReturn(LineEditOutcome.LINE_NOT_FOUND);
        assertThatThrownBy(() -> service.insertLineAfter(user, script, line, "dialogue", character, "x"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("line_not_found"));
        when(scripts.insertLineAfter(user, script, line, "dialogue", null, "x")).thenReturn(LineEditOutcome.INVALID_LINE);
        assertThatThrownBy(() -> service.insertLineAfter(user, script, line, "dialogue", null, "x"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("invalid_line"));
    }

    @Test
    @DisplayName("닫힌 계정이면 403 account_deactivated")
    void closedOwnerIsForbidden() {
        when(scripts.insertLineAfter(user, script, line, "direction", null, "x")).thenThrow(new ScriptRepository.OwnerNotActive());
        assertThatThrownBy(() -> service.insertLineAfter(user, script, line, "direction", null, "x"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("account_deactivated"));
    }
}
