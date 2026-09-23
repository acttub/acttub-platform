package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.MemorizationRepository.Change;
import com.acttub.actingapi.feature.reading.app.MemorizationRepository.MemorizationView;
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 암기 표시의 규칙 — 줄마다 "이 대사 외웠어요"·"아직 헷갈려요"를 남기고 대본 단위로 한 번에 읽는다 (reading.memorization).
 *
 * <p>외웠는지는 배우가 정한다 — 대조 통과를 자동으로 표시하지 않고, 암기 화면은 회차·녹음을 만들지 않는다. 서버는 줄이
 * 그 대본의 <b>대사 줄</b>인지만 본다(배역은 기기의 것이라 상대역 대사 줄도 받는다). 여기서 거절하는 것은 규칙이고 본문은
 * 사유 코드 하나다: 지문·장면 줄 {@code invalid_line}, 없는 것과 남의 것 {@code line_not_found}·{@code script_not_found}.
 */
public class MemorizationService {

    private final MemorizationRepository memorization;
    private final Clock clock;

    public MemorizationService(MemorizationRepository memorization, Clock clock) {
        this.memorization = memorization;
        this.clock = clock;
    }

    /** 마지막 요청이 남는다(두 기기가 다르게 갱신해도). 같은 상태의 재전송은 갱신 시각을 바꾸지 않는다. */
    public MemorizationView set(UUID userId, UUID lineId, String status) {
        Change change = memorization.set(userId, lineId, status, clock.instant());
        if (change == null) {
            throw new ApiException(404, "line_not_found");
        }
        if (change.outcome() == MemorizationRepository.Outcome.INVALID_LINE) {
            throw new ApiException(422, "invalid_line");
        }
        return change.view();
    }

    public List<MemorizationView> list(UUID userId, UUID scriptId) {
        List<MemorizationView> rows = memorization.list(userId, scriptId);
        if (rows == null) {
            throw new ApiException(404, "script_not_found");
        }
        return rows;
    }
}
