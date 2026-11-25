package com.acttub.actingapi.feature.profile.lifecycle;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Date;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.platform.security.AccountSecrets;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 계정 수명 일(탈퇴·미성년 닫기·3년 파기·게스트 이전·연습 삭제)의 고정 테스트가 쓰는 자료를 심는다.
 *
 * <p>한 사람의 자료를 {@code users} 에서 외래 키로 닿는 모든 표에 한 줄 이상 넣는다. 어느 표가 빠졌는지는
 * {@link AccountLifecycleFreezeIT} 가 DB 카탈로그와 맞춰 본다. 새 표를 더하면 여기에도 심어야 그 테스트가 통과한다.
 *
 * <p>id 는 이름에서 만든다({@link #id}). 기준 파일은 행을 id 대신 그 이름으로 적는다.
 * 시각은 모두 테스트 시계({@code now})에서 잰 값이다.
 */
final class AccountLifecycleSeed {

    /** 지운 연습을 들고 있는 계정({@code PostgresPracticeGroupErasure.DELETED_PRACTICE_OWNER} 와 같은 값). */
    static final UUID DELETED_PRACTICE_OWNER = UUID.fromString("00000000-0000-4000-8000-00000000de1e");

    /** 로그인 신원의 모양. */
    enum Identity { MEMBER, GUEST }

    private final JdbcTemplate jdbc;
    private final AccountSecrets secrets;
    private final Instant now;
    private final String salt;

    /** 심은 id → 이름. 기준 파일은 id 대신 이 이름을 적는다. */
    final Map<UUID, String> names = new LinkedHashMap<>();
    /** 실행마다 같지만 읽기 어려운 글자(해시) → 이름. */
    final Map<String, String> texts = new LinkedHashMap<>();
    /** 심은 객체 키 전부. 가짜 저장소가 지우기를 거절하게 할 때 쓴다. */
    final List<String> objectKeys = new ArrayList<>();

    private UUID category;
    private UUID teamChallenge;
    private UUID ad;
    private final Map<String, UUID> documents = new LinkedHashMap<>();

    /** @param salt 시나리오마다 다른 글자. 같은 이름이 시나리오마다 다른 id 가 되어, 주체별 요청 한도가 시나리오 사이에 쌓이지 않는다 */
    AccountLifecycleSeed(JdbcTemplate jdbc, AccountSecrets secrets, Instant now, String salt) {
        this.jdbc = jdbc;
        this.secrets = secrets;
        this.now = now;
        this.salt = salt;
        names.put(DELETED_PRACTICE_OWNER, "지운 연습 보관 계정");
    }

    /** 이름에서 id 를 만든다. 한 시나리오 안에서 같은 이름은 같은 id 다. */
    UUID id(String name) {
        UUID id = UUID.nameUUIDFromBytes((salt + "/" + name).getBytes(StandardCharsets.UTF_8));
        names.put(id, name);
        return id;
    }

    /** 계정 밖의 자료: 동의 문서, 광고, 팀 챌린지, 지운 연습 보관 계정. 시나리오마다 한 번 부른다. */
    void shared() {
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            UUID document = id("문서/" + type);
            documents.put(type, document);
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, document, type, type + " 제목", type + " 본문", !"retention".equals(type), at(Duration.ofDays(-30)));
        }
        category = jdbc.queryForObject("SELECT id FROM community_categories ORDER BY slug LIMIT 1", UUID.class);
        names.put(category, "게시판 분류");
        ad = id("광고");
        jdbc.update("INSERT INTO ads(id,kind) VALUES (?,'house')", ad);
        teamChallenge = id("팀 챌린지");
        jdbc.update("""
                INSERT INTO challenges(id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?,'대사 한 줄','작품',7,'team',?,?,?,?)
                """, teamChallenge, id("팀 챌린지/요청"), hash("팀 챌린지"), at(Duration.ofDays(-1)), at(Duration.ofDays(6)));
        jdbc.update("""
                INSERT INTO users(id,status,created_at,updated_at,retention_purged_at)
                VALUES (?,'deactivated',?,?,?)
                """, DELETED_PRACTICE_OWNER, at(Duration.ofDays(-90)), at(Duration.ofDays(-90)), at(Duration.ofDays(-90)));
    }

    /** 자료를 빠짐없이 가진 계정. {@code retention} 은 보관 동의의 결정({@code granted}·{@code declined})이다. */
    UUID full(String who, Identity identity, String retention) {
        UUID user = light(who, identity, retention);
        history(who, user);
        return user;
    }

    /**
     * 「자료가 없는」 계정이 가질 수 있는 것만 심는다: 계정 행과 함께 지워지는 표({@code ON DELETE CASCADE}), 동의·토큰·신원,
     * 그리고 외래 키 없이 사용자를 가리키는 표다. 만 14세 미만 닫기가 계정 행을 지우는 갈래를 본다.
     */
    UUID light(String who, Identity identity, String retention) {
        UUID user = id(who);
        jdbc.update("""
                INSERT INTO users(id,email,status,nickname,created_at,updated_at,age_confirmed_at)
                VALUES (?,?,'active','옛닉네임',?,?,?)
                """, user, who + "@example.test", at(Duration.ofDays(-60)), at(Duration.ofDays(-60)), at(Duration.ofDays(-60)));
        if (identity == Identity.GUEST) {
            identity(who, user, "guest", null, null);
        } else {
            identity(who, user, "google", null, null);
            identity(who, user, "apple", secrets.encrypt("apple-grant:" + who), null);
            identity(who, user, "kakao", null, null);
            identity(who, user, "naver", null, secrets.encrypt("naver-refresh:" + who));
        }
        jdbc.update("""
                INSERT INTO user_profiles(user_id,name,gender,birth_date,experience,goal,photo_key,bio,
                                          notify_analysis_done,notify_challenge,notify_evening_reminder,
                                          photo_upload_key,photo_upload_mime_type,photo_upload_size_bytes,
                                          photo_upload_expires_at,signup_client,created_at,updated_at)
                VALUES (?,?,'female',?,'exam_prep','audition',?,'입시 준비 중입니다',true,true,true,?,'image/jpeg',10,?,'app/0.1.0',?,?)
                """, user, who + " 배우", Date.valueOf(LocalDate.of(1999, 3, 2)), key(who, "profile/photo.jpg"),
                key(who, "profile/pending.jpg"), at(Duration.ofHours(1)), at(Duration.ofDays(-60)), at(Duration.ofDays(-60)));
        for (String direction : List.of("media", "stage")) {
            jdbc.update("INSERT INTO user_profile_directions(id,user_id,direction) VALUES (?,?,?)",
                    id(who + "/방향/" + direction), user, direction);
        }
        for (Map.Entry<String, UUID> document : documents.entrySet()) {
            jdbc.update("INSERT INTO user_consents(id,user_id,document_id,action,occurred_at) VALUES (?,?,?,?,?)",
                    id(who + "/동의/" + document.getKey()), user, document.getValue(),
                    "retention".equals(document.getKey()) ? retention : "granted", at(Duration.ofDays(-20)));
        }
        UUID liveToken = id(who + "/리프레시 토큰/살아 있음");
        jdbc.update("INSERT INTO refresh_tokens(id,user_id,token_hash,issued_at,expires_at) VALUES (?,?,?,?,?)",
                liveToken, user, hash(who + "/리프레시 토큰/살아 있음"), at(Duration.ofDays(-10)), at(Duration.ofDays(20)));
        jdbc.update("""
                INSERT INTO refresh_tokens(id,user_id,replaced_by_id,token_hash,issued_at,expires_at,revoked_at)
                VALUES (?,?,?,?,?,?,?)
                """, id(who + "/리프레시 토큰/폐기됨"), user, liveToken, hash(who + "/리프레시 토큰/폐기됨"),
                at(Duration.ofDays(-20)), at(Duration.ofDays(10)), at(Duration.ofDays(-10)));
        jdbc.update("INSERT INTO push_tokens(id,user_id,token,platform) VALUES (?,?,?,'ios')",
                id(who + "/푸시 토큰"), user, "push-" + who);
        jdbc.update("INSERT INTO push_opens(id,user_id,kind,opened_at) VALUES (?,?,'practice_reminder',?)",
                id(who + "/푸시 연 기록"), user, at(Duration.ofDays(-1)));
        jdbc.update("""
                INSERT INTO practice_reminder_sends(user_id,day,slot,kind,skipped_days,template_id,sent_at)
                VALUES (?,DATE '2026-11-19','practice','daily',0,'t1',?)
                """, user, at(Duration.ofDays(-1)));
        jdbc.update("INSERT INTO user_active_days(user_id,day) VALUES (?,DATE '2026-11-19')", user);
        jdbc.update("""
                INSERT INTO user_signup_attributions(user_id,source,platform,channel,campaign,recorded_via,recorded_at)
                VALUES (?,'airbridge','ios','instagram','launch','app',?)
                """, user, at(Duration.ofDays(-60)));
        jdbc.update("INSERT INTO user_airbridge_device_lookups(user_id,platform,device_uuid) VALUES (?,'ios',?)",
                user, "device-" + who);
        jdbc.update("INSERT INTO user_discovery_answers(user_id,source,other_text) VALUES (?,'other','지인 소개')", user);
        jdbc.update("INSERT INTO ad_events(id,ad_id,user_id,slot,event,day) VALUES (?,?,?,'home','impression',DATE '2026-11-19')",
                id(who + "/광고 노출"), ad, user);
        jdbc.update("INSERT INTO ad_serves(id,user_id) VALUES (?,?)", id(who + "/광고 내보냄"), user);
        jdbc.update("INSERT INTO reading_voice_usage(user_id,day,lines) VALUES (?,DATE '2026-11-19',3)", user);
        // 쓰인 코드는 심지 않는다. 쓰인 코드는 「옮겨진 게스트」의 표식이라 닫힌 계정의 요청이 guest_transferred 로 막힌다.
        jdbc.update("INSERT INTO guest_transfer_codes(id,user_id,code_hash,expires_at) VALUES (?,?,?,?)",
                id(who + "/이전 코드/살아 있음"), user, hash(who + "/이전 코드/살아 있음"), at(Duration.ofMinutes(10)));
        jdbc.update("INSERT INTO support_inquiries(id,category,email,body,user_id) VALUES (?,'account',?,'문의 본문',?)",
                id(who + "/문의"), who + "@example.test", user);

        jdbc.update("INSERT INTO portfolios(user_id,intro,share_enabled,share_slug) VALUES (?,'소개글',true,?)", user, "slug-" + who);
        jdbc.update("INSERT INTO portfolio_credits(id,user_id,title,role,year,kind,sort_order) VALUES (?,?,'작품','역할',2024,'film',0)",
                id(who + "/포트폴리오 경력"), user);
        jdbc.update("""
                INSERT INTO portfolio_photos(id,user_id,object_key,mime_type,size_bytes,sort_order,expires_at,uploaded_at)
                VALUES (?,?,?,'image/jpeg',10,0,?,?)
                """, id(who + "/포트폴리오 사진/올림"), user, key(who, "portfolio/1.jpg"), at(Duration.ofHours(-1)), at(Duration.ofHours(-2)));
        jdbc.update("""
                INSERT INTO portfolio_photos(id,user_id,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,?,'image/jpeg',10,?)
                """, id(who + "/포트폴리오 사진/올리는 중"), user, key(who, "portfolio/pending.jpg"), at(Duration.ofHours(1)));

        UUID subscription = id(who + "/구독");
        jdbc.update("""
                INSERT INTO billing_subscriptions(id,user_id,status,customer_key,billing_key,card_company,card_number,amount,
                                                  current_period_start,current_period_end,next_retry_at)
                VALUES (?,?,'active',?,?,'카드사','1234-****',9900,?,?,?)
                """, subscription, user, "customer-" + who, "billing-key-" + who,
                at(Duration.ofDays(-5)), at(Duration.ofDays(25)), at(Duration.ofDays(1)));
        jdbc.update("""
                INSERT INTO billing_payments(id,subscription_id,user_id,order_id,kind,amount,status,period_start,period_end)
                VALUES (?,?,?,?,'first',9900,'approved',?,?)
                """, id(who + "/결제"), subscription, user, "order-" + who, at(Duration.ofDays(-5)), at(Duration.ofDays(25)));
        jdbc.update("INSERT INTO billing_pro_grants(id,user_id,starts_at,ends_at,reason) VALUES (?,?,?,?,'promo')",
                id(who + "/Pro 지급"), user, at(Duration.ofDays(-5)), at(Duration.ofDays(25)));
        for (String status : List.of("open", "done")) {
            jdbc.update("""
                    INSERT INTO billing_checkouts(id,user_id,state_hash,purpose,customer_key,order_id,status,expires_at)
                    VALUES (?,?,?,'subscribe',?,?,?,?)
                    """, id(who + "/결제창/" + status), user, hash(who + "/결제창/" + status), "customer-" + who,
                    "checkout-" + who + "-" + status, status, at(Duration.ofMinutes(30)));
        }
        jdbc.update("INSERT INTO script_cocreations(id,user_id,request_id,conditions,versions) VALUES (?,?,?,'슬픈 장면','[]')",
                id(who + "/대사 같이 만들기"), user, id(who + "/대사 같이 만들기/요청"));

        // 앞서 지운 연습이 남긴 것: 무료 횟수 표시와, 보관 동의로 남긴 영상(영상 행의 주인은 보관 계정이다).
        jdbc.update("""
                INSERT INTO practice_deletion_marks(id,user_id,practice_created_at,from_reading,deleted_at)
                VALUES (?,?,?,false,?)
                """, id(who + "/지운 연습 표시"), user, at(Duration.ofDays(-3)), at(Duration.ofDays(-2)));
        UUID deletedVideo = id(who + "/지운 연습의 영상");
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,poster_key)
                VALUES (?,?,?,'video/mp4',1000,12000,?)
                """, deletedVideo, DELETED_PRACTICE_OWNER, key(who, "videos/deleted.mp4"), key(who, "videos/deleted.jpg"));
        jdbc.update("INSERT INTO video_transcripts(id,video_id,status,source) VALUES (?,?,'ready','stt')",
                id(who + "/지운 연습의 영상/받아쓰기"), deletedVideo);
        jdbc.update("INSERT INTO deleted_practice_videos(video_id,user_id,deleted_at) VALUES (?,?,?)",
                deletedVideo, user, at(Duration.ofDays(-2)));
        return user;
    }

    /** 연습·리딩·챌린지·게시판 자료. 한 줄이라도 있으면 계정 행을 지우지 못하고 탈퇴 절차로 닫는다. */
    private void history(String who, UUID user) {
        // 아직 때가 되지 않은 정리(앞서 바꾼 프로필 사진의 객체 삭제)
        jdbc.update("""
                INSERT INTO account_cleanup_operations(id,user_id,kind,payload_encrypted,next_attempt_at,expires_at)
                VALUES (?,?,'object_delete',?,?,?)
                """, id(who + "/기다리는 정리"), user, secrets.encrypt("[\"" + key(who, "profile/replaced.jpg") + "\"]"),
                at(Duration.ofDays(1)), at(Duration.ofDays(7)));

        // 옛 연습 흐름(0.1.0 이전)
        UUID finalizedUpload = id(who + "/옛 올리기/확정");
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at,finalized_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',100,?,?)
                """, finalizedUpload, user, key(who, "uploads/legacy.mp4"), at(Duration.ofHours(1)), at(Duration.ofDays(-40)));
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,'pending','s3',?,'video/mp4',100,?)
                """, id(who + "/옛 올리기/미확정"), user, key(who, "uploads/pending.mp4"), at(Duration.ofHours(1)));
        UUID session = id(who + "/옛 연습");
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,blockage_kind,sub_branch,goal)
                VALUES (?,?,?,'analyzing','상황','인물','분석','캐릭터 분석','목표')
                """, session, user, finalizedUpload);
        jdbc.update("INSERT INTO transcripts(id,session_id,ord,text) VALUES (?,?,0,'받아쓴 말')", id(who + "/옛 연습/받아쓰기"), session);
        UUID summary = id(who + "/옛 연습/요약");
        jdbc.update("INSERT INTO summaries(id,session_id,model,raw) VALUES (?,?,'test-model','{}'::jsonb)", summary, session);
        jdbc.update("""
                INSERT INTO anomalies(summary_id,sort_order,start_ts,end_ts,dimension,what,why_odd,likely_cause,
                                      impact_on_intent,intent_impact,severity,severity_reason)
                VALUES (?,0,'00:01','00:02','표정','무엇','왜','원인','영향','약화','mid','까닭')
                """, summary);
        UUID coachSession = id(who + "/옛 연습/코치 대화");
        jdbc.update("INSERT INTO coach_sessions(id,summary_id,practice_session_id) VALUES (?,?,?)", coachSession, summary, session);
        jdbc.update("INSERT INTO coach_turns(session_id,turn_index,role,text) VALUES (?,0,'ai','첫 질문')", coachSession);
        UUID handoff = id(who + "/옛 연습/넘김");
        jdbc.update("INSERT INTO coaching_handoffs(id,coach_session_id,practice_session_id) VALUES (?,?,?)", handoff, coachSession, session);
        jdbc.update("""
                INSERT INTO practice_reports(id,practice_session_id,report_type,report_json,source_handoff_id)
                VALUES (?,?,'analysis','{}'::jsonb,?)
                """, id(who + "/옛 연습/리포트"), session, handoff);
        jdbc.update("""
                INSERT INTO external_operations(id,session_id,user_id,request_id,kind,status,request_fingerprint,
                                                lease_token,lease_expires_at,monitoring_lease_token)
                VALUES (?,?,?,?,'analyze','running',?,?,?,?)
                """, id(who + "/옛 작업/도는 중"), session, user, id(who + "/옛 작업/도는 중/요청"), hash(who + "/옛 작업/도는 중"),
                id(who + "/옛 작업/도는 중/lease"), at(Duration.ofMinutes(5)), id(who + "/옛 작업/도는 중/감시 lease"));
        jdbc.update("""
                INSERT INTO external_operations(id,session_id,user_id,request_id,kind,status,request_fingerprint,response_payload)
                VALUES (?,?,?,?,'report','succeeded',?,'{"ok":true}'::jsonb)
                """, id(who + "/옛 작업/끝남"), session, user, id(who + "/옛 작업/끝남/요청"), hash(who + "/옛 작업/끝남"));
        jdbc.update("""
                INSERT INTO actor_memory_entries(id,user_id,field,value,written_by,source_practice_session_id)
                VALUES (?,?,'goal','옛 기억','actor',?)
                """, id(who + "/옛 기억"), user, session);

        // 보관함 영상. 1번은 지울 묶음만 쓰고, 2번은 파일이 이미 파기됐고, 3번은 다른 묶음과 챌린지 참여작이 쓴다.
        UUID groupVideo = video(who, user, "1", null);
        video(who, user, "2", at(Duration.ofDays(-3)));
        UUID sharedVideo = video(who, user, "3", null);
        jdbc.update("INSERT INTO video_transcripts(id,video_id,status,source) VALUES (?,?,'ready','stt')",
                id(who + "/영상/1/받아쓰기"), groupVideo);

        // 리딩
        UUID script = id(who + "/대본");
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,source,request_id,request_fingerprint)
                VALUES (?,?,'대본 제목','원문','paste',?,?)
                """, script, user, id(who + "/대본/요청"), hash(who + "/대본"));
        UUID character = id(who + "/대본/배역");
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'배역',0)", character, script);
        UUID line = id(who + "/대본/줄/대사");
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (?,?,1,'dialogue',?,'대사')",
                line, script, character);
        UUID direction = id(who + "/대본/줄/지문");
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,text) VALUES (?,?,2,'direction','지문')", direction, script);
        UUID reading = id(who + "/리딩 회차");
        jdbc.update("""
                INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,
                                             advance,record,status,current_line_id)
                VALUES (?,?,?,?,ARRAY[?]::uuid[],'read',?,?,'manual',true,'in_progress',?)
                """, reading, script, user, id(who + "/리딩 회차/요청"), character, line, direction, line);
        jdbc.update("""
                INSERT INTO reading_session_ratings(id,session_id,user_id,rating,comment,request_id)
                VALUES (?,?,?,'good','좋았어요',?)
                """, id(who + "/리딩 회차/평가"), reading, user, id(who + "/리딩 회차/평가/요청"));
        UUID recording = id(who + "/리딩 녹음");
        jdbc.update("""
                INSERT INTO reading_recordings(id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,
                                               content_type,byte_size,duration_ms,transcript,transcript_source,matched)
                VALUES (?,?,?,?,?,1,?,'audio/mp4',100,1500,'받아쓴 대사','stt',true)
                """, recording, user, reading, line, id(who + "/리딩 녹음/요청"), key(who, "readings/1.m4a"));
        jdbc.update("INSERT INTO reading_recording_retranscripts(recording_id,object_key,status) VALUES (?,?,'done')",
                recording, "users/" + who + "/readings/1.m4a");
        jdbc.update("INSERT INTO reading_pronunciation_reports(id,reading_session_id,user_id,status) VALUES (?,?,?,'ready')",
                id(who + "/리딩 발음 리포트"), reading, user);
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (?,?,?,'memorized')",
                id(who + "/암기 상태"), user, line);
        UUID scriptUpload = id(who + "/대본 원본 파일");
        jdbc.update("""
                INSERT INTO script_uploads(id,user_id,object_key,byte_size,raw_text,script_id,expires_at,file_name)
                VALUES (?,?,?,100,'원문',?,?,'대본.pdf')
                """, scriptUpload, user, key(who, "scripts/source.pdf"), script, at(Duration.ofHours(1)));
        UUID splitJob = job(who, user, "대본 나누기", "script_split", id(who + "/대본 나누기 요청"), "pending");
        jdbc.update("""
                INSERT INTO script_imports(id,user_id,request_id,request_fingerprint,title,source,raw_text,raw_hash,job_id,upload_id)
                VALUES (?,?,?,?,'나누는 대본','file','원문',?,?,?)
                """, id(who + "/대본 나누기 요청"), user, id(who + "/대본 나누기 요청/요청"), hash(who + "/대본 나누기 요청"),
                hash(who + "/대본 나누기 요청/원문"), splitJob, scriptUpload);

        // 연습(0.1.0). 묶음 하나(회차 둘)와, 리딩에서 온 다른 묶음 하나.
        UUID root = practice(who, user, "묶음/1회차", null, 1, "closed", groupVideo, null);
        UUID second = practice(who, user, "묶음/2회차", root, 2, "analyzing", groupVideo, null);
        practice(who, user, "리딩에서 온 연습", null, 1, "closed", sharedVideo, reading);
        jdbc.update("""
                INSERT INTO analyses(id,practice_id,format,status,model,record,completed_at)
                VALUES (?,?,'video_record_v1','ready','test-model','{}'::jsonb,?)
                """, id(who + "/분석"), root, at(Duration.ofDays(-2)));
        UUID conversation = id(who + "/코치 대화");
        jdbc.update("""
                INSERT INTO coach_conversations(id,practice_id,start_request_id,status,close_reason,closed_at)
                VALUES (?,?,?,'closed','user_ended',?)
                """, conversation, root, id(who + "/코치 대화/요청"), at(Duration.ofDays(-2)));
        jdbc.update("INSERT INTO coach_messages(id,conversation_id,turn_index,role,text) VALUES (?,?,0,'ai','첫 질문')",
                id(who + "/코치 대화/말"), conversation);
        UUID note = id(who + "/코치 노트");
        jdbc.update("INSERT INTO coach_notes(id,conversation_id,format,kind,source_revision) VALUES (?,?,'v2','analysis',1)",
                note, conversation);
        jdbc.update("""
                INSERT INTO note_ratings(id,practice_id,note_id,user_id,rating,comment,request_id)
                VALUES (?,?,?,?,'helpful','도움이 됐어요',?)
                """, id(who + "/노트 평가"), root, note, user, id(who + "/노트 평가/요청"));
        jdbc.update("""
                INSERT INTO practice_feedback(id,user_id,practice_id,screen,trigger,body,contact_email,contact_phone,request_id)
                VALUES (?,?,?,'coach','x','의견 본문',?,'010-0000-0000',?)
                """, id(who + "/의견"), user, root, who + "@example.test", id(who + "/의견/요청"));
        jdbc.update("""
                INSERT INTO actor_journals(id,user_id,practice_id,conversation_id,answers,draft_status)
                VALUES (?,?,?,?,'{}','ready')
                """, id(who + "/배우 일지"), user, root, conversation);
        jdbc.update("INSERT INTO actor_memories(id,user_id,field,value,written_by) VALUES (?,?,'goal','오디션 합격','actor')",
                id(who + "/기억/목표"), user);
        jdbc.update("""
                INSERT INTO actor_memories(id,user_id,field,value,written_by,source_practice_id,scene_root_id)
                VALUES (?,?,'habits','말끝을 흐린다','agent',?,?)
                """, id(who + "/기억/장면"), user, root, root);
        job(who, user, "분석", "analyze", second, "running");
        job(who, user, "기억 갱신", "memory_update", conversation, "pending");
        job(who, user, "끝난 분석", "analyze", root, "succeeded");

        // 챌린지
        jdbc.update("""
                INSERT INTO challenges(id,line,work,duration_days,origin,host_user_id,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?,'연 대사','작품',7,'member',?,?,?,?,?)
                """, id(who + "/연 챌린지"), user, id(who + "/연 챌린지/요청"), hash(who + "/연 챌린지"),
                at(Duration.ofDays(-1)), at(Duration.ofDays(6)));
        UUID entry = id(who + "/참여작");
        jdbc.update("""
                INSERT INTO challenge_entries(id,challenge_id,user_id,video_id,caption,published_at,visibility,request_id,
                                              request_fingerprint,face_mosaic,mosaic_status,mosaic_key)
                VALUES (?,?,?,?,'참여작 글',?,'public',?,?,true,'ready',?)
                """, entry, teamChallenge, user, sharedVideo, at(Duration.ofHours(-5)), id(who + "/참여작/요청"),
                hash(who + "/참여작"), key(who, "mosaic/1.mp4"));
        UUID reportJob = job(who, user, "참여작 리포트", "challenge_report", entry, "succeeded");
        jdbc.update("""
                INSERT INTO entry_ai_reports(id,entry_id,user_id,job_id,status,model,result,requested_at,completed_at)
                VALUES (?,?,?,?,'ready','test-model','{"report":"본문"}'::jsonb,?,?)
                """, id(who + "/참여작 리포트"), entry, user, reportJob, at(Duration.ofHours(-4)), at(Duration.ofHours(-3)));
        jdbc.update("""
                INSERT INTO entry_ranking_snapshots(id,challenge_id,viewer_id,basis,entry_ids,ranks,created_at)
                VALUES (?,?,?,'live',ARRAY[?]::uuid[],ARRAY[1],?)
                """, id(who + "/순위 표본"), teamChallenge, user, entry, at(Duration.ofHours(-1)));
        jdbc.update("""
                INSERT INTO notifications(id,user_id,kind,challenge_id,event_key,group_key,created_at,expires_at,push_status)
                VALUES (?,?,'challenge_ended',?,?,?,?,?,'skipped')
                """, id(who + "/받은 알림"), user, teamChallenge, "ended-" + who, "ended-" + who,
                at(Duration.ofHours(-1)), at(Duration.ofDays(30)));
        jdbc.update("INSERT INTO notification_pushes(id,group_key,stage,user_id,created_at) VALUES (?,?,'first',?,?)",
                id(who + "/알림 푸시"), "ended-" + who, user, at(Duration.ofHours(-1)));

        // 게시판
        UUID post = id(who + "/게시글");
        jdbc.update("INSERT INTO community_posts(id,category_id,author_id,title,body) VALUES (?,?,?,'글 제목','글 본문')",
                post, category, user);
        jdbc.update("""
                INSERT INTO community_post_images(id,post_id,uploader_id,object_key,mime_type,size_bytes,sort_order,expires_at,uploaded_at)
                VALUES (?,?,?,?,'image/jpeg',10,0,?,?)
                """, id(who + "/게시글 사진/붙음"), post, user, key(who, "community/1.jpg"), at(Duration.ofHours(-1)), at(Duration.ofHours(-2)));
        jdbc.update("""
                INSERT INTO community_post_images(id,uploader_id,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,?,'image/jpeg',10,?)
                """, id(who + "/게시글 사진/안 붙음"), user, key(who, "community/pending.jpg"), at(Duration.ofHours(1)));
    }

    /** {@code who} 가 {@code other} 의 자료에 남긴 것: 차단, 좋아요·댓글·저장·신고, 상대가 받은 알림. 둘 다 {@link #full} 이어야 한다. */
    void cross(String who, String other) {
        UUID user = id(who);
        UUID counterpart = id(other);
        String pair = who + "→" + other;
        jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", id(pair + "/챌린지 차단"), user, counterpart);
        jdbc.update("INSERT INTO community_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", id(pair + "/게시판 차단"), user, counterpart);
        UUID entry = id(other + "/참여작");
        jdbc.update("INSERT INTO entry_likes(id,entry_id,user_id) VALUES (?,?,?)", id(pair + "/참여작 좋아요"), entry, user);
        jdbc.update("INSERT INTO entry_comments(id,entry_id,user_id,body,request_id,request_fingerprint) VALUES (?,?,?,'잘 봤어요',?,?)",
                id(pair + "/참여작 댓글"), entry, user, id(pair + "/참여작 댓글/요청"), hash(pair + "/참여작 댓글"));
        jdbc.update("INSERT INTO entry_saves(id,entry_id,user_id) VALUES (?,?,?)", id(pair + "/참여작 저장"), entry, user);
        jdbc.update("INSERT INTO entry_view_events(event_id,entry_id,user_id) VALUES (?,?,?)", id(pair + "/참여작 조회"), entry, user);
        jdbc.update("""
                INSERT INTO entry_reports(id,target_type,target_id,reporter_id,reason,target_version,request_id,request_fingerprint)
                VALUES (?,'entry',?,?,'spam',1,?,?)
                """, id(pair + "/참여작 신고"), entry, user, id(pair + "/참여작 신고/요청"), hash(pair + "/참여작 신고"));
        jdbc.update("""
                INSERT INTO notifications(id,user_id,kind,actor_user_id,challenge_id,entry_id,event_key,group_key,
                                          created_at,expires_at,push_status)
                VALUES (?,?,'entry_liked',?,?,?,?,?,?,?,'skipped')
                """, id(pair + "/좋아요 알림"), counterpart, user, teamChallenge, entry, "liked-" + pair, "liked-" + pair,
                at(Duration.ofHours(-1)), at(Duration.ofDays(30)));
        UUID post = id(other + "/게시글");
        jdbc.update("INSERT INTO community_comments(id,post_id,author_id,body) VALUES (?,?,?,'댓글 본문')",
                id(pair + "/게시글 댓글"), post, user);
        jdbc.update("INSERT INTO community_post_likes(id,post_id,user_id) VALUES (?,?,?)", id(pair + "/게시글 좋아요"), post, user);
        jdbc.update("""
                INSERT INTO community_anonymous_aliases(id,post_id,user_id,ordinal)
                SELECT ?,?,?,count(*)+1 FROM community_anonymous_aliases WHERE post_id=?
                """, id(pair + "/게시글 익명 번호"), post, user, post);
        jdbc.update("INSERT INTO community_reports(id,reporter_id,target_type,target_id,reason) VALUES (?,?,'post',?,'spam')",
                id(pair + "/게시글 신고"), user, post);
    }

    private void identity(String who, UUID user, String provider, String appleToken, String naverToken) {
        String uid = provider + "-" + who;
        jdbc.update("""
                INSERT INTO user_identities(id,user_id,provider,provider_uid,apple_token_encrypted,naver_token_encrypted)
                VALUES (?,?,?,?,?,?)
                """, id(who + "/신원/" + provider), user, provider, uid, appleToken, naverToken);
        texts.put(secrets.identityHash(provider, uid), "<해시 " + provider + ":" + uid + ">");
    }

    private UUID video(String who, UUID user, String number, OffsetDateTime purgedAt) {
        UUID video = id(who + "/영상/" + number);
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,favorite,purged_at,poster_key)
                VALUES (?,?,?,'video/mp4',1000,12000,true,?,?)
                """, video, user, key(who, "videos/" + number + ".mp4"), purgedAt, key(who, "videos/" + number + ".jpg"));
        return video;
    }

    private UUID practice(
            String who, UUID user, String name, UUID root, int ordinal, String stage, UUID video, UUID readingSession) {
        UUID practice = id(who + "/연습/" + name);
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,close_reason,experience_version,request_id,
                                      request_fingerprint,blockage_kind,sub_branch,favorite,reading_session_id,session_purpose,created_at)
                VALUES (?,?,?,?,?,?,?,'three_layers_v1',?,?,'표현','감정',true,?,?,?)
                """, practice, user, video, root == null ? practice : root, ordinal, stage,
                "closed".equals(stage) ? "conversation_closed" : null, id(who + "/연습/" + name + "/요청"),
                hash(who + "/연습/" + name), readingSession, readingSession == null ? null : "reading", at(Duration.ofDays(-3)));
        return practice;
    }

    private UUID job(String who, UUID user, String name, String kind, UUID target, String status) {
        UUID job = id(who + "/작업/" + name);
        boolean leased = "running".equals(status);
        jdbc.update("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,lease_token,lease_expires_at,result)
                VALUES (?,?,?,?,?,?,?,?,?,CAST(? AS jsonb))
                """, job, user, kind, target, id(who + "/작업/" + name + "/요청"), hash(who + "/작업/" + name), status,
                leased ? id(who + "/작업/" + name + "/lease") : null, leased ? at(Duration.ofMinutes(5)) : null,
                "succeeded".equals(status) ? "{\"done\":true}" : null);
        return job;
    }

    private String key(String who, String path) {
        String key = "users/" + who + "/" + path;
        objectKeys.add(key);
        return key;
    }

    private OffsetDateTime at(Duration fromNow) {
        return now.plus(fromNow).atOffset(ZoneOffset.UTC);
    }

    /** 64자 16진수. {@code character(64)} 칸(지문·토큰 해시)에 넣는다. */
    private static String hash(String name) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(name.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
