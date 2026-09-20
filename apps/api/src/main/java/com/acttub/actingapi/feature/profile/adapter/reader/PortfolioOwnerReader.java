package com.acttub.actingapi.feature.profile.adapter.reader;

import java.time.LocalDate;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.app.PortfolioOwners;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import org.springframework.stereotype.Component;

/** 포트폴리오의 공개 페이지가 읽는 주인의 정보. 공개하는 넷만 넘긴다 — 이름·사진·성별·만 나이. */
@Component
class PortfolioOwnerReader implements PortfolioOwners {
    private final ProfileService profiles;

    PortfolioOwnerReader(ProfileService profiles) {
        this.profiles = profiles;
    }

    @Override
    public Owner ownerOf(UUID userId) {
        ProfileService.CompleteProfile complete = profiles.completeProfileOf(userId);
        if (complete == null) {
            return null;
        }
        return new Owner(
                complete.profile().name(),
                complete.profile().photoKey(),
                complete.profile().gender(),
                complete.age());
    }

    @Override
    public LocalDate today() {
        return profiles.today();
    }
}
