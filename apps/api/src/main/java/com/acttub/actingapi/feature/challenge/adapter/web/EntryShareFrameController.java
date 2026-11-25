package com.acttub.actingapi.feature.challenge.adapter.web;

import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.EntryShareFrameService;
import com.acttub.actingapi.feature.challenge.app.EntryShareFrameService.FramePreview;
import com.acttub.actingapi.feature.challenge.app.EntryShareFrameService.FrameVideo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.annotation.JsonNaming;

/** 인스타 공유·영상 저장에 씌우는 프레임 (challenge.entry 공유 프레임, SOMA-1156). 본인 참여작에만 만든다. */
@RestController
@RequestMapping("/v2")
class EntryShareFrameController {
    private final EntryShareFrameService frames;
    private final ChallengeMembers members;

    EntryShareFrameController(EntryShareFrameService frames, ChallengeMembers members) {
        this.frames = frames; this.members = members;
    }

    @Schema(name = "ChallengeEntryShareFrameRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record FrameRequest(@NotNull @Schema(allowableValues = {"white", "blue", "black"}) String frame) { }

    @PostMapping("/entries/{id}/share-frames")
    @Operation(summary = "Request Challenge Entry Share Frame", operationId = "request_share_frame_v2_entries__id__share_frames_post",
            description = """
                    본인 참여작 영상에 공유 프레임(1080×1920)을 씌운다. 만들어 둔 것이 있으면 ready(200)와 받을 주소, 만드는
                    중이면 rendering(202)이라 같은 요청을 다시 보낸다. 실패는 failed(200)로 한 번 알리고 다음 요청이 다시 만든다.
                    영상은 본인 재생과 같다(모자이크본이 준비됐으면 모자이크본). 남의·삭제된 참여작 404 entry_not_found, 파일
                    파기 422 video_not_ready, 얼굴 가림을 켰는데 모자이크본이 아직 없음 422 mosaic_not_ready(원본에 씌우지 않는다),
                    저장소 없음 503 storage_not_configured.""",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "200", description = "Ready or failed", content = @Content(schema = @Schema(implementation = FrameVideo.class)))
    @ApiResponse(responseCode = "202", description = "Rendering", content = @Content(schema = @Schema(implementation = FrameVideo.class)))
    ResponseEntity<FrameVideo> video(@PathVariable UUID id, @Valid @RequestBody FrameRequest body, HttpServletRequest request) {
        FrameVideo video = frames.video(members.member(request), id, body.frame());
        return ResponseEntity.status("rendering".equals(video.status()) ? HttpStatus.ACCEPTED : HttpStatus.OK).body(video);
    }

    @GetMapping("/entries/{id}/share-frames/{frame}/preview")
    @Operation(summary = "Get Challenge Entry Share Frame Preview", operationId = "get_share_frame_preview_v2_entries__id__share_frames__frame__preview_get",
            description = """
                    공유 프레임 미리보기 JPEG(폭 540)의 주소. 영상 한 장면에 서버 영상과 같은 틀을 씌운다. frame 은 white·blue·black
                    이고 none 은 틀 없이 장면만이다. 오류는 프레임 요청과 같다. 단 none 은 mosaic_not_ready 없이 본인 재생과 같은
                    장면을 보인다.""",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    FramePreview preview(@PathVariable UUID id,
                         @PathVariable @Schema(allowableValues = {"white", "blue", "black", "none"}) String frame,
                         HttpServletRequest request) {
        return frames.preview(members.member(request), id, frame);
    }
}
