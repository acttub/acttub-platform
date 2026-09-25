package com.acttub.actingapi.feature.profile.adapter.reader;

import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.feature.profile.domain.ProfileLabels;
import com.acttub.actingapi.feature.report.app.ReportProfile;
import org.springframework.stereotype.Component;

/**
 * 노트가 프로필을 읽는 포트의 구현({@code profile → report.app}). {@link CoachProfileReader} 와 같은 것을
 * 노트의 타입으로 내준다 — 완성된 프로필만, 표시말로, 생년월일 대신 만 나이로.
 */
@Component
class ReportProfileReader implements ReportProfile {
    private final ProfileService profiles;

    ReportProfileReader(ProfileService profiles) {
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
