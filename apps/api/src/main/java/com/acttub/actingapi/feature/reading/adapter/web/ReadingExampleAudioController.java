package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.reading.adapter.web.ReadingExampleDtos.AudioResponse;
import com.acttub.actingapi.feature.reading.app.ReadingExampleService;
import com.acttub.actingapi.platform.security.AccessGate;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * 예시를 복사한 대본의 미리 만든 상대역 음성 (reading.script 「예시 대본」, V62). 앱은 이 음성으로 읽어 기기 목소리 모델을 받지 않는다.
 * 리딩 경로라 게스트도 지난다.
 */
@RestController
class ReadingExampleAudioController {
    private final ReadingExampleService examples;
    private final AccessGate auth;

    ReadingExampleAudioController(ReadingExampleService examples, AccessGate auth) {
        this.examples = examples;
        this.auth = auth;
    }

    @Operation(
            summary = "Get Reading Example Audio",
            description = """
                    예시를 복사한 내 대본의 미리 만든 상대역 음성. 대본의 원문이 켜진 예시와 같고 그 예시에 음성이 있으면 200 —
                    voices 는 배역 이름 → 음성을 만든 프리셋, lines 는 예시와 같은 자리·같은 배역·같은 글인 대사 줄마다 line_id 와 1시간
                    임시 주소(url)·길이(duration_ms)다. 고친 줄은 빠진다. 상대역이 없는 예시(독백)는 lines 가 비어 있다. 없는 것·남의
                    대본 404 script_not_found, 예시가 아니거나 음성이 없는 예시 404 reading_example_audio_not_found.""",
            operationId = "get_reading_example_audio_v2_reading_scripts__script_id__example_audio_get",
            tags = "v2-reading",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AudioResponse.class)))
    @GetMapping("/v2/reading/scripts/{script_id}/example-audio")
    AudioResponse audio(@PathVariable("script_id") UUID scriptId, HttpServletRequest request) {
        return AudioResponse.of(examples.audio(auth.gatedUser(request).id(), scriptId));
    }
}
