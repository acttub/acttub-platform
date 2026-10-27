package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.ScriptDraft;
import com.acttub.actingapi.platform.web.CanonicalJson;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 무료 대본 3개 보관(SOMA-818) — 한도가 걸리면 저장 한도를 3으로 넘기고 넘으면 403 free_script_limit. */
class FreeScriptLimitTest {
    final ScriptRepository scripts = mock(ScriptRepository.class);
    final ScriptImportRepository imports = mock(ScriptImportRepository.class);
    final CanonicalJson canonical = new CanonicalJson(new ObjectMapper());
    final Clock clock = Clock.fixed(Instant.parse("2026-10-23T01:00:00Z"), ZoneOffset.UTC);
    final UUID user = UUID.randomUUID();
    final ScriptDraft draft = new ScriptDraft("옥상, 밤", "원문", "paste", List.of("철수"),
            List.of(new ScriptDraft.Line(1, "dialogue", 0, "안녕")));

    @Test
    @DisplayName("직접 저장 — 한도가 걸리면 3개 한도로 저장하고, 넘으면 403 free_script_limit")
    void directSave() {
        when(scripts.create(eq(user), any(), anyString(), any(), anyInt()))
                .thenReturn(new ScriptRepository.Creation(null, false, ScriptRepository.Outcome.OVER_LIMIT));
        ScriptService limited = new ScriptService(scripts, null, canonical, clock, id -> true);
        assertThatThrownBy(() -> limited.create(user, false, UUID.randomUUID(), draft))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("free_script_limit"));
        verify(scripts).create(eq(user), any(), anyString(), any(), eq(3));

        ScriptService free = new ScriptService(scripts, null, canonical, clock, ScriptPlan.UNLIMITED);
        assertThatThrownBy(() -> free.create(user, false, UUID.randomUUID(), draft)).hasMessageContaining("script_limit")
                .hasMessageNotContaining("free_script_limit");
    }

    @Test
    @DisplayName("나누기 요청 — 한도가 걸리면 넘을 때 403 free_script_limit")
    void importRequest() {
        when(imports.consent(user)).thenReturn("granted");
        when(imports.request(eq(user), any(), anyString(), any(), any(), eq(3), anyInt(), any()))
                .thenReturn(new ScriptImportRepository.Requested(null, null, ScriptImportRepository.Outcome.OVER_SCRIPT_LIMIT));
        ScriptImportService service = new ScriptImportService(imports, null, canonical, clock, id -> true);
        assertThatThrownBy(() -> service.request(user, false, UUID.randomUUID(),
                new ScriptImportService.Submission("제목", "철수: 안녕", "paste", false, false, null)))
                .hasMessageContaining("free_script_limit");
    }
}
