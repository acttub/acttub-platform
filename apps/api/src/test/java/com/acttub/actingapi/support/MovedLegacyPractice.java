package com.acttub.actingapi.support;

import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 옛 표에 심은 연습을 <b>옮긴 뒤의 모양</b>으로 만든다 — 회차는 같은 id·같은 주인으로 새 표에 있고, 대화는 가장 최근
 * 하나만 새 표로 갔다(specs/practice 「0.1.0 스키마 전환」). 옮기는 명령은 운영에서 한 번 돌리고 지웠다. 옛 표에 남은
 * 자료(이전 대화, 앞선 대화의 노트)를 읽는 테스트가 이 모양을 쓴다.
 */
public final class MovedLegacyPractice {
    private MovedLegacyPractice() {
    }

    /** 옛 {@code practice_sessions} 행 하나를 묶음의 첫 회차로 새 표에 둔다. 대화가 있었으면 닫힌 회차다. */
    public static void move(JdbcTemplate jdbc, UUID practiceSessionId) {
        UUID videoId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                SELECT ?,ui.user_id,ui.object_key,ui.mime_type,ui.size_bytes,COALESCE(ui.duration_ms,0)
                FROM practice_sessions ps JOIN upload_intents ui ON ui.id=ps.upload_intent_id
                WHERE ps.id=?
                """, videoId, practiceSessionId);
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,close_reason,experience_version,
                                      situation,character_context,goal,blockage_kind,sub_branch,blockage_detail,
                                      legacy_hidden_at,created_at,updated_at)
                SELECT ps.id,ps.user_id,?,ps.id,1,
                       CASE WHEN EXISTS (SELECT 1 FROM coach_sessions cs WHERE cs.practice_session_id=ps.id)
                            THEN 'closed' ELSE 'conversing' END,
                       CASE WHEN EXISTS (SELECT 1 FROM coach_sessions cs WHERE cs.practice_session_id=ps.id)
                            THEN 'conversation_closed' END,
                       ps.experience_version,ps.situation,ps.character_context,ps.goal,
                       ps.blockage_kind,ps.sub_branch,ps.blockage_detail,ps.hidden_at,ps.created_at,ps.updated_at
                FROM practice_sessions ps
                WHERE ps.id=?
                """, videoId, practiceSessionId);
    }

    /** 그 연습의 가장 최근 옛 대화를 같은 id 로 새 표에 둔다. 앞선 대화는 옛 표에만 남는다. */
    public static void moveLatestConversation(JdbcTemplate jdbc, UUID practiceSessionId) {
        jdbc.update("""
                INSERT INTO coach_conversations(id,practice_id,start_request_id,status,state,state_revision,
                                                created_at,updated_at,closed_at)
                SELECT cs.id,cs.practice_session_id,cs.id,'closed','{}'::jsonb,0,cs.created_at,cs.updated_at,cs.updated_at
                FROM coach_sessions cs
                WHERE cs.practice_session_id=?
                ORDER BY cs.created_at DESC,cs.id DESC
                LIMIT 1
                """, practiceSessionId);
        jdbc.update("""
                INSERT INTO coach_messages(id,conversation_id,turn_index,role,text,created_at)
                SELECT gen_random_uuid(),c.id,t.turn_index,t.role::text,t.text,t.created_at
                FROM coach_conversations c JOIN coach_turns t ON t.session_id=c.id
                WHERE c.practice_id=?
                """, practiceSessionId);
    }
}
