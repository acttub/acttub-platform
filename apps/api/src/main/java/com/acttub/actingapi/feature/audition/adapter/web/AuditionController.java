package com.acttub.actingapi.feature.audition.adapter.web;

import com.acttub.actingapi.feature.audition.adapter.web.AuditionDtos.AuditionPostingList;
import com.acttub.actingapi.feature.audition.app.AuditionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 오디션 공고 모아보기(app.audition). 로그인 무관 — 입시 정보처럼 게이트 밖이고 토큰을 보지 않는다. */
@RestController
@RequestMapping("/v2/auditions")
class AuditionController {
    private final AuditionService auditions;

    AuditionController(AuditionService auditions) {
        this.auditions = auditions;
    }

    @Operation(
            summary = "List Auditions",
            description = """
                    지금 지원할 수 있는 오디션 공고 전부를 마감이 가까운 순(마감일 없는 것은 뒤, 그다음 최근 게시)으로.
                    마감일이 있으면 오늘(KST)까지, 없으면 게시 45일 안이고 마감 표시가 없는 것만 낸다. 기능이 꺼진
                    서버는 빈 items 다. 지원은 항상 source_url 의 원문에서 한다.""",
            operationId = "list_auditions_v2_auditions_get",
            tags = "v2-auditions")
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AuditionPostingList.class)))
    @GetMapping
    AuditionPostingList list() {
        return AuditionPostingList.of(auditions.list());
    }
}
