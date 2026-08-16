package com.acttub.actingapi.report.app;

/** 성적표와, 그것을 만든 연습을 다시 볼 수 있는 주소. */
public record PlayableReport(ReportDetail report, String playbackUrl) {
}
