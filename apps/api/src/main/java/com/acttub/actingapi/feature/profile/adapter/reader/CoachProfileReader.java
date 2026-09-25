package com.acttub.actingapi.feature.profile.adapter.reader;

import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.ActorProfile;
import com.acttub.actingapi.feature.coach.app.CoachProfile;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.feature.profile.domain.ProfileLabels;
import org.springframework.stereotype.Component;

/**
 * 코치가 프로필을 읽는 포트의 구현. 선언은 읽는 쪽({@code coach/app})에 있고 구현은 프로필을 소유한
 * 여기다 — 간선은 {@code profile → coach.app} 한 방향이고 코치는 profile 을 알지 못한다(ADR-017·019).
 *
 * <p>내주는 것은 <b>완성된</b> 프로필뿐이고 값은 표시말이다. 생년월일은 내주지 않는다 — 만 나이만 간다.
 * 노트 쪽은 {@link ReportProfileReader} 가 같은 것을 노트의 타입으로 내준다(교환 타입은 소비자에 산다).
 */
@Component
class CoachProfileReader implements CoachProfile {
    private final ProfileService profiles;

    CoachProfileReader(ProfileService profiles) {
        this.profiles = profiles;
    }

    @Override
    public ActorProfile completeFor(UUID userId) {
        ProfileService.CompleteProfile complete = profiles.completeProfileOf(userId);
        return complete == null ? null : new ActorProfile(
                complete.profile().name(),
                ProfileLabels.gender(complete.profile().gender()),
                complete.age(),
                ProfileLabels.directions(complete.profile().directions()),
                ProfileLabels.experience(complete.profile().experience()),
                ProfileLabels.goal(complete.profile().goal()));
    }
}
