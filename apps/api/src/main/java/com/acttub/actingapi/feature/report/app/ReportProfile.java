package com.acttub.actingapi.feature.report.app;

import java.util.List;
import java.util.UUID;

/**
 * report 가 배우의 프로필에 요구하는 것. 노트가 설명의 깊이와 제안을 배우의 경력에 맞추는 데 쓴다.
 *
 * <p>선언이 여기 있고 구현은 프로필을 소유한 {@code profile} 이 한다(ADR-017). 코치의
 * {@code CoachProfile} 과 따로 둔다 — 두 도메인이 포트 하나를 나눠 쓰면 한쪽이 다른 쪽의 {@code app}
 * 을 거쳐 프로필을 보게 되고, 노트가 코치 없이 만들어지는 길({@code POST /v2/reports})이 코치에 묶인다.
 *
 * <p>프로필은 <b>모델 입력으로만</b> 쓴다. handoff·영상 근거·공개 노트 필드로 복사하지 않고, 이미 만든
 * 노트를 프로필이 바뀌었다고 다시 만들지 않는다.
 */
public interface ReportProfile {

    /** 필수 여섯 항목을 다 채운 프로필만. 없거나 하나라도 비어 있으면 {@code null}. */
    ActorProfile completeFor(UUID userId);

    /**
     * 모델에 그대로 넘기는 모양. 값은 전부 표시말이고 나이는 제공자가 한국 시간의 오늘로 센 만 나이다.
     * 생년월일은 넘어오지 않는다.
     */
    record ActorProfile(
            String name,
            String gender,
            int age,
            List<String> directions,
            String experience,
            String goal) {

        public ActorProfile {
            directions = List.copyOf(directions);
        }
    }
}
