package com.acttub.actingapi.feature.audition.adapter.web;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

import com.acttub.actingapi.feature.audition.app.AuditionService.AuditionList;
import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.acttub.actingapi.feature.audition.domain.AuditionRules;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

final class AuditionDtos {
    private AuditionDtos() {
    }

    @Schema(name = "AuditionPostingList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AuditionPostingList(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "지금 지원할 수 있는 공고. 마감이 가까운 순")
            List<AuditionPostingItem> items,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    description = "마지막으로 공고를 모은 시각. 한 번도 모으지 못했으면 null")
            Instant collectedAt) {

        static AuditionPostingList of(AuditionList list) {
            return new AuditionPostingList(list.items().stream().map(AuditionPostingItem::of).toList(),
                    list.collectedAt());
        }
    }

    @Schema(name = "AuditionPosting", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "공고의 사실 항목. 지원은 항상 source_url 의 원문에서 한다.")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AuditionPostingItem(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "<source>-<원문 번호>. 기기의 찜·봤음 저장 열쇠")
            String id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "원문 제목 그대로") String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {
                "film", "short_film", "drama", "web_drama", "short_form", "commercial", "music_video", "theater",
                "musical", "agency_open", "other"})
            String category,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"shinsee", "emk", "sejong", "plfil", "otr"})
            String source,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "화면에 쓰는 출처 이름") String sourceName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "출연료 문구 원문 그대로")
            String payText,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, type = "string", format = "date")
            String applyStart,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, type = "string", format = "date")
            String applyEnd,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "원문의 상태 문구")
            String statusText,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string", format = "date") String postedOn,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "원문 주소") String sourceUrl) {

        static AuditionPostingItem of(AuditionPosting p) {
            return new AuditionPostingItem(p.id(), p.title(), p.category(), p.source(),
                    AuditionRules.sourceName(p.source()), p.payText(), text(p.applyStart()), text(p.applyEnd()),
                    p.statusText(), text(p.postedOn()), p.sourceUrl());
        }

        private static String text(LocalDate date) {
            return date == null ? null : date.toString();
        }
    }
}
