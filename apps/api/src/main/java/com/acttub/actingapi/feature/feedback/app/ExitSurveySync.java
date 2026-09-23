package com.acttub.actingapi.feature.feedback.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.SheetRow;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.stereotype.Service;

/**
 * 설문 영역에서 매일 도는 일 (practice.feedback).
 *
 * <ol>
 *   <li>아직 시트에 못 보낸 설문을 다시 보낸다 — 접수 때 실패했거나 연락처를 파기해 다시 보내야 하는 것들이다.</li>
 *   <li>접수 90일이 지난 연락처를 DB 에서 비우고 같은 설문 id·새 순번으로 시트에 다시 보내 시트의 연락처도
 *       지운다. 본문은 사람과 끊어 남는다.</li>
 * </ol>
 *
 * <p>순서가 중요하다 — 먼저 비우고 나서 보내야 그날 안에 시트의 연락처까지 사라진다.
 *
 * <p>한 건이 실패해도 나머지는 돈다. 실패한 것은 {@code sheet_synced_at} 이 NULL 로 남아 다음 날 다시 본다.
 */
@Service
public class ExitSurveySync {

    /** 연락처를 들고 있는 기간. */
    public static final Duration CONTACT_RETENTION = Duration.ofDays(90);

    private static final int BATCH = 100;

    private final ExitSurveyStore store;
    private final ExitSurveySheet sheet;
    private final FailureReporter failureReporter;
    private final Clock clock;

    public ExitSurveySync(
            ExitSurveyStore store,
            ExitSurveySheet sheet,
            FailureReporter failureReporter,
            Clock clock) {
        this.store = store;
        this.sheet = sheet;
        this.failureReporter = failureReporter;
        this.clock = clock;
    }

    /** @return 이번에 시트로 보낸 설문 수 */
    public int runDaily() {
        Instant now = clock.instant();
        try {
            store.purgeExpiredContacts(now.minus(CONTACT_RETENTION), now);
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("ExitSurveySync.purgeContacts"));
        }
        return sync(now);
    }

    /** 접수 직후에 한 번 보낸다. 어떤 실패도 밖으로 나가지 않는다 — 접수는 이미 끝났다. */
    public void attempt() {
        sync(clock.instant());
    }

    private int sync(Instant now) {
        int sent = 0;
        while (true) {
            List<SheetRow> pending = store.pendingSheetRows(BATCH);
            int before = sent;
            for (SheetRow row : pending) {
                if (send(row, now)) {
                    sent++;
                }
            }
            // 묶음을 다 채우지 못했거나 하나도 보내지 못했으면 멈춘다 — 못 보낸 행은 그대로 남아
            // 다음 날 다시 본다. 이 조건이 없으면 시트가 죽은 동안 같은 묶음을 영원히 돈다.
            if (pending.size() < BATCH || sent == before) {
                return sent;
            }
        }
    }

    private boolean send(SheetRow row, Instant now) {
        try {
            sheet.upsert(row);
            store.markSheetSynced(row.id(), row.seq(), now);
            return true;
        } catch (RuntimeException failure) {
            // 접수는 유지하고 sheet_synced_at 은 NULL 그대로다 — 다음 날 다시 보낸다.
            failureReporter.report(failure, new FailureContext("ExitSurveySync.upsert", row.id()));
            return false;
        }
    }
}
