package com.acttub.actingapi.admissions;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

final class AdmissionDtos {
    private AdmissionDtos() {
    }

    @Schema(
            name = "AdmissionResource",
            description = "입시생이 참고할 만한 영상·글. 링크만 담고 본문은 옮기지 않는다(저작권).\n\n"
                    + "`source_type`을 반드시 붙인다 - 학원 홍보 영상과 대학 공식 영상을 같은 줄에\n"
                    + "늘어놓으면 입시생이 광고를 정보로 읽는다.",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdmissionResource(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String kind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String url,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String publisher,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String sourceType,
            @Schema(nullable = true) String note,
            @Schema(nullable = true) String verifiedAt) {
    }

    @Schema(
            name = "AdmissionTip",
            description = "다녀온 사람들이 남긴 실전 정보. **사실만 우리 문장으로 옮긴다.**\n\n"
                    + "후기 글·영상은 남의 저작물이라 문장을 그대로 가져오지 않는다. 대신 거기서\n"
                    + "확인되는 사실(\"대기가 세 시간 넘는다\", \"고사장에 주차장이 없다\")만 추려\n"
                    + "우리가 다시 쓰고, 판단은 사용자가 하도록 원문 링크를 함께 준다.\n\n"
                    + "요강에 적힌 규정은 여기가 아니라 `dress_code`·`preparation`에 넣는다.\n"
                    + "이 필드는 **요강에 없는데 겪어 봐야 아는 것**만 담는다.",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdmissionTip(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String category,
            @Schema(nullable = true) String sourceUrl,
            @Schema(defaultValue = "personal") String sourceType,
            @Schema(nullable = true) String host,
            @Schema(nullable = true) Integer corroborations,
            @Schema(nullable = true) String verifiedAt,
            @Schema(nullable = true) String note) {
        AdmissionTip {
            sourceType = sourceType == null ? "personal" : sourceType;
        }
    }

    @Schema(
            name = "AdmissionUniversity",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdmissionUniversity(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String admissionUrl,
            @Schema(nullable = true) String region,
            @Schema(nullable = true) String campus,
            @Schema(nullable = true) String type,
            @Schema(nullable = true) String verifiedAt,
            @Schema(nullable = true) String note,
            List<AdmissionResource> resources,
            List<AdmissionTip> tips) {
        AdmissionUniversity {
            resources = immutable(resources);
            tips = immutable(tips);
        }
    }

    @Schema(
            name = "AdmissionResult",
            description = "전년도 입시결과. 대학이 공개한 값만 담고, 나머지는 None으로 남긴다.",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdmissionResult(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int year,
            @Schema(nullable = true) Integer quota,
            @Schema(nullable = true) Integer applicants,
            @Schema(nullable = true) String competitionRate,
            @Schema(nullable = true) String transcriptAvg,
            @Schema(nullable = true) String transcriptCut50,
            @Schema(nullable = true) String transcriptCut70,
            @Schema(nullable = true) String transcriptLow,
            @Schema(nullable = true) String practicalAvg,
            @Schema(nullable = true) String practicalCut50,
            @Schema(nullable = true) String practicalCut70,
            @Schema(nullable = true) String fillRate,
            @Schema(nullable = true) Integer waitlistLast,
            @Schema(nullable = true) Integer waitlistCount,
            @Schema(nullable = true) String sourceUrl,
            @Schema(nullable = true) String verifiedAt,
            @Schema(nullable = true) String note) {
    }

    @Schema(
            name = "AdmissionWeights",
            description = "전형요소 반영비율(%). 원문에 숫자가 그대로 적힌 경우에만 채운다.\n\n"
                    + "PDF 표를 텍스트로 뽑으면 행·열이 뒤엉켜 오독하기 쉬운데, 이 값이 틀리면\n"
                    + "지원 전략을 통째로 그르친다. 판독이 조금이라도 애매하면 전부 None으로 두고\n"
                    + "`AdmissionNotice.weights_note`에 원문 표기를 그대로 옮겨 적는다.",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AdmissionWeights(
            @Schema(nullable = true) Double practical,
            @Schema(nullable = true) Double transcript,
            @Schema(nullable = true) Double csat,
            @Schema(nullable = true) Double interview,
            @Schema(nullable = true) Double portfolio,
            @Schema(nullable = true) Double other) {
    }

    @Schema(
            name = "AdmissionStage",
            description = "단계별 전형. 1차에서 몇 배수를 뽑는지가 지원 판단을 가른다.",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AdmissionStage(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int order,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
            @Schema(nullable = true) String date,
            List<String> evaluates,
            @Schema(nullable = true) String multiple,
            @Schema(nullable = true) Double weight,
            @Schema(nullable = true) String note) {
        AdmissionStage {
            evaluates = immutable(evaluates);
        }
    }

    @Schema(
            name = "AdmissionPracticalItem",
            description = "실기 종목 하나. 서술형 `practical_task`를 필터·비교용으로 쪼갠 것이다.\n\n"
                    + "원문 서술이 정본이고 이쪽은 보조다 — 대학마다 실기 구성이 제각각이라\n"
                    + "category로 다 담기지 않는 경우 `note`에 원문을 남긴다.",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdmissionPracticalItem(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String category,
            @Schema(nullable = true) String label,
            @JsonProperty("required") @Schema(nullable = true) Boolean requiredValue,
            @Schema(nullable = true) Integer timeLimitSec,
            @Schema(nullable = true) Integer count,
            @Schema(nullable = true) Double weight,
            @Schema(nullable = true) Integer stage,
            @Schema(nullable = true) String note) {
    }

    @Schema(
            name = "AdmissionNotice",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdmissionNotice(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String universityId,
            @Schema(nullable = true) String department,
            @Schema(nullable = true) String discipline,
            @Schema(nullable = true) Integer admissionYear,
            @Schema(nullable = true) String track,
            @Schema(nullable = true) String screening,
            @Schema(nullable = true) String applyStart,
            @Schema(nullable = true) String applyEnd,
            @Schema(nullable = true) String practicalDate,
            @Schema(nullable = true) String practicalDateEnd,
            @Schema(nullable = true) String announceDate,
            @Schema(nullable = true) String practicalTask,
            @Schema(nullable = true) String quota,
            @Schema(nullable = true) String fee,
            @Schema(nullable = true) String csatMinimum,
            @Schema(nullable = true) String documents,
            @Schema(nullable = true) String dressCode,
            @Schema(nullable = true) String preparation,
            List<String> designatedWorks,
            List<String> essayQuestions,
            @Schema(nullable = true) AdmissionWeights weights,
            @Schema(nullable = true) String weightsNote,
            List<AdmissionStage> stages,
            List<AdmissionPracticalItem> practicalItems,
            List<AdmissionResult> results,
            @Schema(nullable = true) String sourceUrl,
            @Schema(nullable = true) String verifiedAt,
            @Schema(nullable = true) String note) {
        AdmissionNotice {
            designatedWorks = immutable(designatedWorks);
            essayQuestions = immutable(essayQuestions);
            stages = immutable(stages);
            practicalItems = immutable(practicalItems);
            results = immutable(results);
        }
    }

    @Schema(
            name = "AdmissionsResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdmissionsResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String updatedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String disclaimer,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdmissionUniversity> universities,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdmissionNotice> notices) {
        AdmissionsResponse {
            universities = immutable(universities);
            notices = immutable(notices);
        }
    }

    private static <T> List<T> immutable(List<T> values) {
        return values == null ? List.of() : List.copyOf(values);
    }
}
