package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

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
            JobView job) {
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
}
