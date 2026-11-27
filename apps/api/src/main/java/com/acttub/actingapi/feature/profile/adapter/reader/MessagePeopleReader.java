package com.acttub.actingapi.feature.profile.adapter.reader;

import java.util.UUID;

import com.acttub.actingapi.feature.message.app.MessagePeople;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import org.springframework.stereotype.Component;

/**
 * 1:1 메시지가 읽는 상대의 공개 정보({@code profile → message.app}, SOMA-1039). 공개하는 것은 이름과 사진뿐이고, 계정 상태
 * (활성·회원)는 보낼 수 있는지 가르는 데만 쓴다.
 */
@Component
class MessagePeopleReader implements MessagePeople {
    private final ProfileService profiles;

    MessagePeopleReader(ProfileService profiles) {
        this.profiles = profiles;
    }

    @Override
    public Person find(UUID userId) {
        ProfileService.AccountView view = profiles.lookup(userId);
        if (view == null) {
            return null;
        }
        return new Person(
                userId,
                view.account().profile() == null ? null : view.account().profile().name(),
                view.photoUrl(),
                "active".equals(view.account().status()),
                "member".equals(view.account().accountType()));
    }
}
