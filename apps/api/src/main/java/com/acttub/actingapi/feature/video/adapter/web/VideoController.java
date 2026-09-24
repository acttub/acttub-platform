package com.acttub.actingapi.feature.video.adapter.web;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.video.adapter.web.VideoDtos.IntentRequest;
import com.acttub.actingapi.feature.video.adapter.web.VideoDtos.IntentResponse;
import com.acttub.actingapi.feature.video.adapter.web.VideoDtos.PatchRequest;
import com.acttub.actingapi.feature.video.adapter.web.VideoDtos.VideoListResponse;
import com.acttub.actingapi.feature.video.adapter.web.VideoDtos.VideoResponse;
import com.acttub.actingapi.feature.video.app.VideoService;
import com.acttub.actingapi.feature.video.domain.VideoRules;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 영상 보관함 (practice.record, practice.library). 전부 보호 기능이고 웹 게스트도 쓴다(게스트의 기능 표
 * {@code PRACTICE}, 문서 셋).
 *
 * <p>값의 모양(필수·형식·필터 이름)은 여기서 422 배열로, 규칙(한도·총량·시한·참조)은 서비스가 사유 코드 하나로
 * 답한다(CONTRACT §6-2).
 */
@RestController
@RequestMapping("/v2/videos")
class VideoController {
    private static final Set<String> FILTERS = Set.of("all", "recent7", "favorite");

    private final VideoService videos;
    private final AccessGate auth;

    VideoController(VideoService videos, AccessGate auth) {
        this.videos = videos;
        this.auth = auth;
    }

    @Operation(
            summary = "Create Video Intent",
            description = """
                    올릴 자리를 내준다. 같은 요청 id 의 재전송은 같은 자리이고(기기가 올리다 만 객체를 이어 올린다),
                    같은 id 에 다른 본문이면 422 request_fingerprint_mismatch. 100MiB 초과는 video_too_large,
                    5분 초과는 video_too_long, 총량을 넘겼으면 video_quota 다.""",
            operationId = "create_video_intent_v2_videos_intents_post",
            tags = "v2-videos",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = IntentResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/intents")
    @ResponseStatus(HttpStatus.CREATED)
    IntentResponse createIntent(
            @Valid @RequestBody IntentRequest body,
            @RequestHeader(name = "X-Request-Id", required = false) String requestIdHeader,
            HttpServletRequest request) {
        RequestIdHeader.requireMatching(requestIdHeader, body.requestId());
        String contentType = VideoRules.normalize(body.contentType());
        if (contentType == null) {
            throw ApiValidationException.valueError(
                    List.of("body", "content_type"),
                    "Value error, content_type must be video/mp4 or video/quicktime",
                    body.contentType());
        }
        AuthenticatedUser user = auth.gatedUser(request);
        var created = videos.createIntent(
                user.id(), user.guest(), body.requestId(), contentType, body.byteSize(), body.durationMs());
        return new IntentResponse(created.intentId(), created.uploadUrl(), created.expiresAt());
    }

    @Operation(
            summary = "Complete Video Intent",
            description = """
                    올라온 것을 확인하고 보관함에 영상을 만든다. 만들면 201, 마무리 재전송이면 200 으로 같은 영상이다.
                    시한(30분)이 지났으면 422 upload_expired 이고 미확정 객체는 삭제 장부로 간다. 아직 안 올라왔으면
                    422 video_not_ready, 이 확정이 총량을 넘기면 422 video_quota 다.""",
            operationId = "complete_video_intent_v2_videos_intents__intent_id__complete_post",
            tags = "v2-videos",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "201",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = VideoResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PostMapping("/intents/{intent_id}/complete")
    ResponseEntity<VideoResponse> completeIntent(
            @PathVariable("intent_id") UUID intentId,
            HttpServletRequest request) {
        AuthenticatedUser user = auth.gatedUser(request);
        VideoService.Completion completion = videos.completeIntent(user.id(), user.guest(), intentId);
        return ResponseEntity
                .status(completion.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(VideoResponse.of(completion.video()));
    }

    @Operation(
            summary = "List Videos",
            description = """
                    보관함을 최신 저장순으로. 필터는 all·recent7(최근 7일)·favorite 이고 예시 영상을 섞지 않는다.
                    재생 주소는 상세에만 있다. 포스터(첫 장면 JPEG)의 10분 서명 주소 poster_url 은 목록에도 있고,
                    아직 만들지 않았거나 파기된 영상은 null 이다.""",
            operationId = "list_videos_v2_videos_get",
            tags = "v2-videos",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = VideoListResponse.class)))
    @GetMapping
    VideoListResponse list(
            @RequestParam(name = "filter", required = false, defaultValue = "all") String filter,
            @RequestParam(name = "cursor", required = false) String cursor,
            HttpServletRequest request) {
        if (!FILTERS.contains(filter)) {
            throw ApiValidationException.valueError(
                    List.of("query", "filter"), "Value error, filter must be all, recent7 or favorite", filter);
        }
        var page = videos.list(auth.gatedUser(request).id(), filter, cursor);
        return new VideoListResponse(page.videos().stream().map(VideoResponse::of).toList(), page.nextCursor());
    }

    @Operation(
            summary = "Get Video",
            description = "영상 하나 — 10분 서명 재생 주소와 사용처(회차 수·챌린지 참여작 수)가 붙는다. 파기된 영상은 주소가 없다.",
            operationId = "get_video_v2_videos__video_id__get",
            tags = "v2-videos",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = VideoResponse.class)))
    @GetMapping("/{video_id}")
    VideoResponse find(@PathVariable("video_id") UUID videoId, HttpServletRequest request) {
        return VideoResponse.of(videos.find(auth.gatedUser(request).id(), videoId));
    }

    @Operation(
            summary = "Update Video",
            description = "즐겨찾기를 바꾼다.",
            operationId = "update_video_v2_videos__video_id__patch",
            tags = "v2-videos",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = VideoResponse.class)))
    @ApiResponse(
            responseCode = "422",
            description = "Validation Error",
            content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    @PatchMapping("/{video_id}")
    VideoResponse patch(
            @PathVariable("video_id") UUID videoId,
            @Valid @RequestBody PatchRequest body,
            HttpServletRequest request) {
        return VideoResponse.of(videos.setFavorite(auth.gatedUser(request).id(), videoId, body.favorite()));
    }

    @Operation(
            summary = "Delete Video",
            description = """
                    보관함에서 지운다 — 참조(회차·챌린지 참여작)가 없을 때만. 있으면 422 video_in_use 이고 아무것도
                    지워지지 않는다(사용처는 상세 조회로 본다). 지우면 받아쓰기도 함께 지우고 객체는 삭제 장부로 간다.""",
            operationId = "delete_video_v2_videos__video_id__delete",
            tags = "v2-videos",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(responseCode = "204", description = "Successful Response")
    @DeleteMapping("/{video_id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable("video_id") UUID videoId, HttpServletRequest request) {
        videos.delete(auth.gatedUser(request).id(), videoId);
    }

    @Operation(
            summary = "Purge Video File",
            description = """
                    파일만 파기한다 — 회차·참여작의 기록은 남기고 객체와 받아쓰기를 지운다. 그 영상은 재생 불가로
                    표시되고 총량에서 빠진다. 총량이 가득한 계정이 공간을 되찾는 길이다.""",
            operationId = "purge_video_file_v2_videos__video_id__purge_file_post",
            tags = "v2-videos",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = VideoResponse.class)))
    @PostMapping("/{video_id}/purge-file")
    VideoResponse purgeFile(@PathVariable("video_id") UUID videoId, HttpServletRequest request) {
        return VideoResponse.of(videos.purgeFile(auth.gatedUser(request).id(), videoId));
    }
}
