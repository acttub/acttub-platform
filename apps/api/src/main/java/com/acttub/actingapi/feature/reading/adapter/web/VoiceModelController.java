package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.List;

import com.acttub.actingapi.feature.reading.app.VoiceModelService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 리딩 기기 목소리 모델(fp16 묶음)의 내려받을 임시 주소(SOMA-747). 게스트도 리딩을 하므로 로그인만 본다. */
@RestController
@RequestMapping("/v2/reading/voice-model")
class VoiceModelController {
    private final VoiceModelService models;
    private final AccessGate auth;
    VoiceModelController(VoiceModelService models, AccessGate auth) { this.models = models; this.auth = auth; }

    record FileResponse(String name, long bytes, String sha256, String url) {}

    record ModelResponse(String version, List<FileResponse> files, @JsonProperty("expires_in") int expiresIn) {}

    @Operation(summary = "Device voice model download urls", tags = "v2-reading", security = @SecurityRequirement(name = "HTTPBearer"))
    @GetMapping
    ModelResponse current(HttpServletRequest request) {
        auth.gatedUser(request);
        var model = models.current();
        return new ModelResponse(model.version(),
                model.files().stream().map(f -> new FileResponse(f.name(), f.bytes(), f.sha256(), f.url())).toList(),
                model.expiresIn());
    }
}
