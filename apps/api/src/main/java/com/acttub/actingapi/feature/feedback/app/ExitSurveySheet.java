package com.acttub.actingapi.feature.feedback.app;

import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.SheetRow;

/**
 * 설문 복제본을 두는 곳 — 구글 시트 (practice.feedback).
 *
 * <p><b>DB 가 정본이고 시트는 복제본이다.</b> 접수는 DB 커밋으로 끝나고 여기로 보내는 것은 뒤의 일이다 —
 * 여기서 난 실패는 접수를 되돌리지 않는다.
 *
 * <p>시트는 설문 id 로 <b>한 줄</b>만 둔다. 같은 id 로 다시 보내면 그 줄을 갈아 끼우고, 순번이 작은 전송은
 * 무시한다 — 오래된 전송이 파기한 연락처를 되살리지 못한다.
 *
 * <p>이 전송은 AI 작업이 아니라 {@code ai_jobs} 에 넣지 않는다.
 */
public interface ExitSurveySheet {

    /** @throws RuntimeException 보내지 못했다. 부르는 쪽이 {@code sheet_synced_at} 을 NULL 로 두고 다음 날 다시 본다 */
    void upsert(SheetRow row);

    /**
     * 보낼 시트가 붙어 있는가. 아니면 동기화는 아무것도 보내지 않고 오류로도 알리지 않는다(SOMA-829) — 시트가 아직
     * 없는 것은 장애가 아니라 정해진 상태라, 매일 Sentry 오류로 쌓이면 진짜 장애를 가린다. 행은 그대로 남아 시트가
     * 붙는 날 한꺼번에 간다.
     */
    default boolean configured() {
        return true;
    }
}
