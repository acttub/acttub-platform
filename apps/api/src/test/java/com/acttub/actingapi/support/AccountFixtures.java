package com.acttub.actingapi.support;

import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 게이트를 통과한 회원을 만드는 fixture.
 *
 * <p>보호 기능은 동의를 모두 결정하고 프로필 여섯 항목을 채운 회원만 쓴다. 그 기능 <b>자체</b>를
 * 보려는 테스트가 게이트 앞에서 멈추지 않게, 가입을 끝낸 회원의 모양을 한 번에 세운다.
 */
public final class AccountFixtures {

    private AccountFixtures() {
    }

    /** 프로필 여섯 항목을 채운다. 이미 있으면 그대로 둔다. */
    public static void completeProfile(JdbcTemplate jdbc, UUID userId) {
        jdbc.update("""
                INSERT INTO user_profiles(user_id,name,gender,birth_date,experience,goal)
                VALUES (?,'테스트 배우','unspecified',DATE '2000-01-01','y1_to_3','audition')
                ON CONFLICT (user_id) DO NOTHING
                """, userId);
        jdbc.update("""
                INSERT INTO user_profile_directions(user_id,direction)
                VALUES (?,'media')
                ON CONFLICT (user_id,direction) DO NOTHING
                """, userId);
    }

    /** 지금 발행돼 있는 모든 문서의 현재 판에 동의한다(선택 문서 포함). */
    public static void grantAllConsents(JdbcTemplate jdbc, UUID userId) {
        jdbc.update("""
                INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                SELECT gen_random_uuid(), ?, latest.id, 'granted', now()
                FROM (SELECT DISTINCT ON (type) id
                      FROM consent_documents
                      -- 문서의 신원은 한국어 행이 쥔다(SOMA-544). 번역본 행에 동의하면 게이트가 모른다.
                      WHERE locale = 'ko'
                      ORDER BY type, published_at DESC, id DESC) latest
                """, userId);
    }

    /** 가입을 끝낸 회원: 모든 문서를 결정했고 프로필이 완성돼 있다. */
    public static void passGate(JdbcTemplate jdbc, UUID userId) {
        grantAllConsents(jdbc, userId);
        completeProfile(jdbc, userId);
    }
}
