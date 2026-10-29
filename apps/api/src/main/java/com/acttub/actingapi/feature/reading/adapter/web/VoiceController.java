package com.acttub.actingapi.feature.reading.adapter.web;

import com.acttub.actingapi.feature.reading.adapter.web.VoiceDtos.StatusResponse;
import com.acttub.actingapi.feature.reading.adapter.web.VoiceDtos.SynthesizeRequest;
import com.acttub.actingapi.feature.reading.adapter.web.VoiceDtos.SynthesizeResponse;
import com.acttub.actingapi.feature.reading.app.CloudVoiceService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiException;
import java.util.UUID;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v2/reading/voice")
class VoiceController {
    private final CloudVoiceService voices;
    private final AccessGate auth;
    VoiceController(CloudVoiceService voices, AccessGate auth) { this.voices = voices; this.auth = auth; }

    @Operation(summary = "Cloud voice status", tags = "v2-reading", security = @SecurityRequirement(name = "HTTPBearer"))
    @GetMapping("/status")
    StatusResponse status(@RequestParam(name = "script_id", required = false) String scriptId,
            @RequestParam(name = "session_id", required = false) String sessionId, HttpServletRequest request) {
        var status = voices.status(member(request).id(), uuid(scriptId), uuid(sessionId));
        return new StatusResponse(status.available(), status.freeUntil(), status.consent(), status.dailyLimit(), status.dailyUsed(),
                status.reason(), status.proOnly());
    }

    @Operation(summary = "Synthesize a reading line", tags = "v2-reading", security = @SecurityRequirement(name = "HTTPBearer"))
    @PostMapping
    SynthesizeResponse synthesize(@RequestBody(required = false) SynthesizeRequest body, HttpServletRequest request) {
        var result = voices.synthesize(member(request).id(), body == null ? null : body.text(), body == null ? null : body.voice(),
                body == null ? null : uuid(body.sessionId()));
        return new SynthesizeResponse(result.audioUrl(), result.cached(), result.expiresIn());
    }

    /** 모르는 값은 없는 것과 같다 — 무료 첫 리딩으로 보지 않을 뿐 요청을 막지 않는다. */
    private static UUID uuid(String value) {
        if (value == null || value.isBlank()) return null;
        try { return UUID.fromString(value.trim()); } catch (IllegalArgumentException error) { return null; }
    }

    private AuthenticatedUser member(HttpServletRequest request) {
        AuthenticatedUser user = auth.gatedUser(request);
        if (user.guest()) throw new ApiException(403, "member_only");
        return user;
    }
}
