package com.acttub.actingapi.feature.feedback.adapter.sheet;

import com.acttub.actingapi.feature.feedback.app.ExitSurveySheet;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.SheetRow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 시트가 붙기 전의 자리 지킴이 (practice.feedback).
 *
 * <p>Apps Script 로 보내는 실제 구현은 운영 비밀(시트 주소·토큰)이 서야 들어온다. 그때까지는 <b>보낸 척하지
 * 않는다</b> — 여기서 성공을 돌려주면 {@code sheet_synced_at} 이 차서 재전송 대상에서 빠지고, 시트가 붙은
 * 날 이미 접수된 설문이 영영 복제되지 않는다. 그래서 실패로 남긴다.
 *
 * <p>본문·연락처는 로그에 싣지 않는다. 남기는 것은 설문 id 와 순번뿐이다.
 *
 * <p>실제 구현이 들어오면 이 빈을 {@code @Primary} 로 덮거나 여기를 갈아 끼운다 —
 * {@code @ConditionalOnMissingBean} 은 쓰지 않는다. 그 조건은 평가 시점까지 등록된 빈만 보므로 일반
 * {@code @Configuration} 사이에서는 설정 처리 순서에 따라 결과가 갈린다({@code AnalysisWorkerConfiguration}
 * 의 같은 주석).
 */
@Component
class LoggingExitSurveySheet implements ExitSurveySheet {
    private static final Logger LOG = LoggerFactory.getLogger(LoggingExitSurveySheet.class);

    @Override
    public void upsert(SheetRow row) {
        LOG.info("이탈 설문 시트 전송 대기: id={} seq={}", row.id(), row.seq());
        throw new SheetNotConfigured();
    }

    /** 시트가 아직 붙지 않았다. 접수는 유지되고 매일 도는 일이 다시 본다. */
    static final class SheetNotConfigured extends RuntimeException {
        SheetNotConfigured() {
            super("exit survey sheet is not configured");
        }
    }
}
