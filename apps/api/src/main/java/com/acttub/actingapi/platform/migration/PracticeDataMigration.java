package com.acttub.actingapi.platform.migration;

import java.util.List;
import java.util.Map;

/**
 * 옛 연습 테이블(V1~V12)의 자료를 1.0.0 테이블(V14)로 옮긴다 (02-practice 「1.0.0 스키마 전환」 ③).
 *
 * <p><b>Flyway 가 아니라 애플리케이션 명령이다.</b> 전환은 작은 묶음으로 나눠 여러 번 돌리고, 중간에 멈춰도
 * 다음 실행이 이어 간다 — 마이그레이션 파일 안에서 하면 배포가 그만큼 멈추고 되돌릴 수 없다.
 *
 * <p><b>옛 테이블은 읽기만 한다.</b> 예외는 {@code upload_intents.video_id} 하나이고, 그것은 V14 가 예약 장부에
 * 더해 둔 "확정된 업로드가 어느 영상이 됐는가" 칸이다 — 옛 서버는 그 칸을 모른다.
 *
 * <p><b>멱등은 대응표가 만든다.</b> 한 번 고른 원본은 {@code practice_migration_entries} 에 적히고 다시 고르지
 * 않는다. 옮기지 않기로 한 자료도 사유와 함께 적힌다 — 새 제약에 맞지 않는 묶음(가지 친 이어하기, 진행 중
 * 회차 둘)은 <b>임의로 닫거나 지우지 않고</b> 옛 테이블에 남겨 호환 읽기 경로가 그대로 보여 준다.
 *
 * <p><b>진행 중인 AI 작업은 옮기지 않는다.</b> 옛 워커가 끝내야 하고, 두 큐에서 같은 작업이 동시에 돌면 안
 * 된다(02-practice ③). 끝난 작업만 이력으로 옮긴다.
 */
public interface PracticeDataMigration {

    /** 한 번에 고르는 원본의 수. 너무 크면 한 트랜잭션이 길어지고 너무 작으면 왕복만 는다. */
    int DEFAULT_BATCH = 200;

    /**
     * 남은 것이 없을 때까지 묶음을 되풀이한다. 각 묶음은 한 트랜잭션이다.
     *
     * @param batchSize 한 묶음에서 고르는 원본 수(단계마다)
     */
    Report run(int batchSize);

    /**
     * 이번 실행이 옮긴 것과 건너뛴 것.
     *
     * @param moved 단계 이름 → 이번 실행에서 옮긴 원본 수
     * @param skipped 단계 이름 → 이번 실행에서 건너뛴 원본 수
     * @param reasons 건너뛴 사유 → 그 사유의 수(대응표 전체 기준)
     * @param batches 돈 묶음의 수
     */
    record Report(
            Map<String, Integer> moved,
            Map<String, Integer> skipped,
            Map<String, Integer> reasons,
            int batches) {

        /** 단계는 이 순서로만 돈다 — 뒤의 단계가 앞의 단계가 만든 행을 가리킨다. */
        public static final List<String> STEPS = List.of(
                "video", "practice", "transcript", "analysis",
                "conversation", "message", "note", "memory", "ai_job");
    }
}
