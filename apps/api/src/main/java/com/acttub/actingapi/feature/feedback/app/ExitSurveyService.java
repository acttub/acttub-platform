package com.acttub.actingapi.feature.feedback.app;

import java.time.Clock;
import java.util.UUID;
import java.util.List;

import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.Accepted;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.NewSurvey;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import org.springframework.stereotype.Service;

/**
 * 코치·노트 화면에서 나가려 할 때 묻는 한 줄 소감 (practice.feedback).
 *
 * <p><b>한 계정에 한 번만 묻는다.</b> 자동 노출 직전에 서버가 계정의 노출 표식을 원자적으로 선점하고 선점한
 * 기기만 시트를 띄운다 — 두 기기가 동시에 물어도 하나다. 건너뛰기도 본문 없는 행으로 남는다.
 *
 * <p><b>제출 실패가 나가기를 막지 않는다.</b> 설문 결과로 대화·노트 상태가 바뀌지 않는다.
 */
@Service
public class ExitSurveyService {

    private final ExitSurveyStore store;
    private final Clock clock;

    public ExitSurveyService(ExitSurveyStore store, Clock clock) {
        this.store = store;
        this.clock = clock;
    }

    /**
     * 설문을 접수한다. UTF-16 단위인 Bean Size 대신 코드 포인트를 세고, 본문은 다듬은 뒤 길이를 본다 —
     * 공백만 보낸 본문은 건너뛰기가 아니라 잘못된 요청이다.
     *
     * @param dismissed 배우가 그냥 나갔으면 참 — 그때만 본문이 없어도 된다
     */
    public Accepted submit(NewSurvey requested, boolean dismissed) {
        String body = ExitSurveyRules.normalize(requested.body());
        if (!dismissed && body == null) {
            throw new ApiException(422, "feedback_body_required");
        }
        validateLength("body", body, ExitSurveyRules.BODY_MAX_CHARS);
        validateLength("contact_email", requested.contactEmail(), ExitSurveyRules.CONTACT_MAX_CHARS);
        validateLength("contact_phone", requested.contactPhone(), ExitSurveyRules.CONTACT_MAX_CHARS);
        if (!store.ownsPractice(requested.userId(), requested.practiceId())) {
            throw new ApiException(404, "practice_not_found");
        }
        Accepted accepted = store.submit(
                new NewSurvey(
                        requested.userId(),
                        requested.requestId(),
                        requested.practiceId(),
                        requested.screen(),
                        requested.trigger(),
                        body,
                        blankToNull(requested.contactEmail()),
                        blankToNull(requested.contactPhone())),
                clock.instant());
        if (accepted == null) {
            // 게이트를 지난 뒤 다른 기기의 탈퇴가 끝났다 — 닫힌 계정에 새 설문을 남기지 않는다.
            throw new ApiException(403, "account_deactivated");
        }
        return accepted;
    }

    /** 이미 물어봤는지만 본다 — 화면을 띄우기 전의 조회이고 표식을 건드리지 않는다. */
    public boolean asked(UUID userId) {
        return store.asked(userId);
    }

    /**
     * 자동 노출 직전의 선점. <b>참을 받은 기기만 시트를 띄운다.</b>
     *
     * @return 이번에 선점했으면 참
     */
    public boolean claim(UUID userId) {
        return store.claimAsk(userId, clock.instant());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static void validateLength(String field, String value, int maximum) {
        if (ExitSurveyRules.length(value) > maximum) {
            throw ApiValidationException.valueError(List.of("body", field),
                    "Value error, must contain at most " + maximum + " characters", value);
        }
    }
}
