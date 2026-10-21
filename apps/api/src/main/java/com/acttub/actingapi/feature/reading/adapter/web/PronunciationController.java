package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository.ReportState;
import com.acttub.actingapi.feature.reading.app.PronunciationReportService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 리딩 발음 보고서(SOMA-606, 실험). 허용 사용자에게만 열리고 계약이 정해지지 않아 OpenAPI 에 싣지 않는다({@link Hidden}).
 *
 * <p>{@code {status, report}} — status 는 not_ready(회차가 끝나지 않음)·queued·running·done·skipped(쓸 줄 없음)·failed.
 * report 는 done·skipped 일 때 {@code summary·misheard·habit·skipped_lines}.
 */
@Hidden
@RestController
@RequestMapping("/v2/reading")
class PronunciationController {
    private final PronunciationReportService reports;
    private final AccessGate auth;
    private final ObjectMapper mapper;

    PronunciationController(PronunciationReportService reports, AccessGate auth, ObjectMapper mapper) {
        this.reports = reports;
        this.auth = auth;
        this.mapper = mapper;
    }

    @GetMapping("/sessions/{session_id}/pronunciation")
    Map<String, Object> get(@PathVariable("session_id") UUID sessionId, HttpServletRequest request) throws JsonProcessingException {
        UUID userId = auth.gatedUser(request).id();
        ReportState state = reports.find(userId, sessionId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", state.status());
        body.put("report", state.resultJson() == null ? null : mapper.readTree(state.resultJson()));
        return body;
    }
}
