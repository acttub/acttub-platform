package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.practice.domain.ObservationPack;
import com.acttub.actingapi.feature.practice.domain.VideoRecordSummary;

/** 회차·묶음이 밖으로 보여 주는 모양 (practice.start, practice.resume, practice.library). */
public final class PracticeViews {

    private PracticeViews() {
    }

    /**
     * 회차 하나.
     *
     * @param stage {@code analyzing}·{@code conversing}·{@code closed}. 분석 결과의 상태와 다른 것이다
     * @param analysisStatus 관찰 기록의 상태({@code ready}·{@code partial}). 아직 없으면 {@code null}
     * @param noteTitle 그 회차 노트의 제목. 없거나 record_only 면 {@code null}
     */
    public record PracticeView(
            UUID id,
            UUID rootId,
            int ordinal,
            UUID videoId,
            String stage,
            String closeReason,
            String experienceVersion,
            String situation,
            String characterContext,
            String goal,
            String blockageKind,
            String subBranch,
            String blockageNote,
            Instant createdAt,
            String analysisStatus,
            UUID conversationId,
            String conversationStatus,
            int conversationCount,
            UUID noteId,
            String noteTitle,
            String noteKind,
            JobView job,
            List<PreviousConversation> previousConversations) {
    }

    /**
     * 그 회차의 이전 대화 하나 (practice.coach).
     *
     * <p>새 표는 회차당 대화 하나라 <b>언제나 빈 목록</b>이다. 채워지는 것은 한 연습에 대화가 여럿인 옛 자료를
     * 호환 경로로 읽을 때뿐이다 — 최근 하나가 "대화" 이고 나머지가 여기 온다.
     */
    public record PreviousConversation(UUID id, String status, Instant createdAt) {
    }

    /**
     * 그 회차의 마지막 분석 작업.
     *
     * @param failureReason {@code failed} 일 때의 분류(timeout·parse·cancelled 등). 그 밖에는 {@code null}
     */
    public record JobView(UUID id, String status, String failureReason, int attemptCount) {
    }

    /**
     * 묶음 하나 — {@code rootId} 가 같은 회차들이다. 속성(제목·태그·즐겨찾기·숨김)은 <b>첫 행</b>에 있다.
     *
     * @param title 첫 행의 제목. 없으면 화면이 마지막 회차 노트 제목 → 상황 문장 → "제목 없는 연습" 순으로 채운다
     * @param inProgressPracticeId 닫히지 않은 회차. 없으면 {@code null} — 409 뒤 복귀가 이 한 값으로 끝난다
     */
    public record GroupView(
            UUID rootId,
            String title,
            int ordinalCount,
            Instant lastConversationAt,
            List<String> tags,
            boolean favorite,
            Instant hiddenAt,
            UUID inProgressPracticeId,
            List<PracticeView> practices) {
    }

    /** 회차의 진행 상태만. 화면이 폴링한다(앱 4초·웹 10초). */
    public record StatusView(String stage, String closeReason, String analysisStatus, JobView job) {
    }

    /** 내부 원문 대신 화면에 필요한 관찰 요약만 전달한다. 두 형식을 이름만 바꿔 혼합하지 않는다. */
    public record AnalysisView(UUID id, String format, String status, ObservationPack observation,
                               VideoRecordSummary videoRecord) { }
}
