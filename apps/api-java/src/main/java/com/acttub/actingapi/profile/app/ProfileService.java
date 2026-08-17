package com.acttub.actingapi.profile.app;

import java.util.UUID;

import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.profile.domain.Profile;
import org.springframework.stereotype.Service;

/**
 * 프로필 조회·수정·탈퇴의 규칙. 셋 다 "그 사용자가 없으면 404" 하나로 끝난다 — 닉네임의
 * 형태를 따지는 일은 요청을 받는 자리(web)가 하고, 여기서는 이미 정규화된 값을 받는다.
 */
@Service
public class ProfileService {
    private final ProfileRepository profiles;

    public ProfileService(ProfileRepository profiles) {
        this.profiles = profiles;
    }

    public Profile find(UUID userId) {
        return require(profiles.find(userId));
    }

    public Profile updateNickname(UUID userId, String nickname) {
        return require(profiles.updateNickname(userId, nickname));
    }

    public void deactivate(UUID userId) {
        require(profiles.deactivate(userId));
    }

    private static Profile require(Profile profile) {
        if (profile == null) {
            throw new ApiException(404, "user_not_found");
        }
        return profile;
    }
}
