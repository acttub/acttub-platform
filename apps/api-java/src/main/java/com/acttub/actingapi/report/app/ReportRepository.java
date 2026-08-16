package com.acttub.actingapi.report.app;

import java.util.List;
import java.util.UUID;

/**
 * report 가 저장소에 요구하는 <b>조회</b>. 성적표를 남기는 일은 {@link PracticeReportLedger} 가
 * 따로 맡는다 — 그쪽은 원장 행까지 한 트랜잭션에서 닫으므로 경계가 다르다.
 *
 * <p>없으면 {@code null} 이다. 한 연산 안에서 갈릴 것이 "있다/없다" 하나뿐이라 예외를 쓸 이유가
 * 없다(ADR-018). 없음을 상태코드로 옮기는 일은 {@link ReportService} 가 한다.
 *
 * <p><b>보는 사람이 인자로 따라다닌다.</b> 성적표는 자기 연습의 것만 보이고, 숨긴 연습의 것은
 * 주인에게도 보이지 않는다 — 조건은 SQL 의 {@code WHERE} 에 들어간다.
 */
public interface ReportRepository {

    /** 만든 순서대로 나열한 성적표 요약. */
    List<ReportSummary> listSummaries(UUID userId);

    /** 그 연습의 가장 최근 성적표와 녹화본 위치. 없으면 {@code null}. */
    ReportDetail findDetail(UUID userId, UUID practiceSessionId);
}
