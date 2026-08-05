package com.acttub.actingapi.report;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

/**
 * {@code complete_report_operation} 이 돌려주는 payload.
 *
 * <p>Python 은 {@code {"report": …, "report_count": n}} dict 를 만들어
 * 그대로 {@code external_operations.response_payload} 에 저장하고 호출자에게도 돌려준다
 * ({@code store.py:1615-1621}). 같은 JSON 이 두 곳에 쓰이므로 record 하나로 둔다.
 */
@JsonPropertyOrder({"report", "report_count"})
public record ReportCompletion(
        @JsonProperty("report") ActingReportPayload report,
        @JsonProperty("report_count") long reportCount) {
}
