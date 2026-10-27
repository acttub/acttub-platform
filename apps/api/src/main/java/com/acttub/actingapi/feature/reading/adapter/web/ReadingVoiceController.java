package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.ReadingVoiceConfiguration;
import com.acttub.actingapi.feature.reading.adapter.voice.ReadingVoiceCoaching;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiException;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 리딩 완료 화면의 「방금 읽은 대본으로 코칭도 받아볼까요?」 카드(SOMA-791). 소리 든 내 대사 녹음이 3줄 이상이면 {@code available}
 * 이고, 그 리딩 회차로 이미 시작한 코칭이 있으면 {@code practice_id} 를 준다. 남의·없는 회차는 404 session_not_found 다.
 */
@Hidden
@RestController
@RequestMapping("/v2/reading")
@ConditionalOnExpression(ReadingVoiceConfiguration.ENABLED)
class ReadingVoiceController {

    private final ReadingVoiceCoaching coaching;
    private final AccessGate auth;

    ReadingVoiceController(ReadingVoiceCoaching coaching, AccessGate auth) {
        this.coaching = coaching;
        this.auth = auth;
    }

    @GetMapping("/sessions/{session_id}/voice-coaching")
    Map<String, Object> get(@PathVariable("session_id") UUID sessionId, HttpServletRequest request) {
        UUID userId = auth.gatedUser(request).id();
        ReadingVoiceCoaching.Availability availability = coaching.availability(userId, sessionId);
        if (availability == null) throw new ApiException(404, "session_not_found");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("available", availability.available());
        body.put("practice_id", availability.practiceId());
        return body;
    }
}
