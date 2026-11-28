-- 만 14세 미만 계정 닫기가 계정 행(users)을 지울 수 있게 한다 (SOMA-1166).
--
-- 가입 중에 만 14세 미만으로 드러난 계정은 탈퇴와 같은 순서로 닫은 뒤(제공자 연결 해제와 객체 삭제를 정리 장부에
-- 올린다) 그 자리에서 계정 행을 지운다(처리방침 「계정과 입력한 정보를 즉시 파기」). 계정 행을 지우면 그 행에서
-- 외래 키로 닿는 행이 모두 함께 지워져야 한다. 그래서
--
--   ① users 에서 외래 키로 닿는 표의 외래 키 가운데 ON DELETE 가 없던 것을 ON DELETE CASCADE 로 바꾼다. 계정 행을
--      지우는 길은 만 14세 미만 닫기뿐이다(탈퇴·게스트 파기·3년 파기는 행을 남긴다). 다른 행을 지우는 지금의 길은
--      그 행을 가리키는 행이 없을 때만 성공하므로, 지금 성공하는 삭제의 결과는 같다.
--   ② challenges.host_user_id 는 ON DELETE SET NULL 로 바꾼다. 챌린지는 다른 사람의 참여작이 매달린 공용 자료다.
--      탈퇴도 이 칸만 비운다.
--   ③ account_cleanup_operations.user_id 는 NULL 을 받게 하고 ON DELETE SET NULL 로 바꾼다. 장부의 일(애플 토큰 폐기,
--      객체 삭제)은 계정 행보다 오래 남아야 하고, 실행에는 kind 와 payload_encrypted 만 쓴다. 계정 행이 지워진 뒤의
--      장부 행에는 그 계정의 id 도 남지 않는다.
--   ④ practice_reports.source_handoff_id 의 ON DELETE RESTRICT 도 CASCADE 로 바꾼다. 리포트와 그 출처 handoff 는 같은
--      연습 세션에서 함께 지워지는데, RESTRICT 는 문장 끝을 기다리지 않고 검사해 지우는 차례에 따라 실패할 수 있다.
--      handoff 를 지우는 코드는 없다.
--
-- 직전 판 API 는 계정 행을 지울 때(자료 없는 만 14세 미만) 신원·토큰·동의를 먼저 지우므로 이 스키마에서도 그대로 돈다.
-- 같은 이름으로 다시 만들어 이름에 기대는 곳이 바뀌지 않는다. 막는 외래 키가 남지 않았는지는
-- AccountLifecycleFreezeIT#nothingBlocksDeletingTheAccountRow 가 카탈로그로 본다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.actor_memories
    DROP CONSTRAINT actor_memories_scene_root_id_fkey,
    ADD CONSTRAINT actor_memories_scene_root_id_fkey FOREIGN KEY (scene_root_id) REFERENCES public.practices(id) ON DELETE CASCADE,
    DROP CONSTRAINT actor_memories_source_practice_id_fkey,
    ADD CONSTRAINT actor_memories_source_practice_id_fkey FOREIGN KEY (source_practice_id) REFERENCES public.practices(id) ON DELETE CASCADE,
    DROP CONSTRAINT actor_memories_user_id_fkey,
    ADD CONSTRAINT actor_memories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.ai_jobs
    DROP CONSTRAINT ai_jobs_user_id_fkey,
    ADD CONSTRAINT ai_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.analyses
    DROP CONSTRAINT analyses_practice_id_fkey,
    ADD CONSTRAINT analyses_practice_id_fkey FOREIGN KEY (practice_id) REFERENCES public.practices(id) ON DELETE CASCADE;

ALTER TABLE public.challenge_entries
    DROP CONSTRAINT challenge_entries_user_id_fkey,
    ADD CONSTRAINT challenge_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    DROP CONSTRAINT challenge_entries_video_id_fkey,
    ADD CONSTRAINT challenge_entries_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;

ALTER TABLE public.challenges
    DROP CONSTRAINT challenges_host_user_id_fkey,
    ADD CONSTRAINT challenges_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.coach_conversations
    DROP CONSTRAINT coach_conversations_practice_id_fkey,
    ADD CONSTRAINT coach_conversations_practice_id_fkey FOREIGN KEY (practice_id) REFERENCES public.practices(id) ON DELETE CASCADE;

ALTER TABLE public.coach_messages
    DROP CONSTRAINT coach_messages_conversation_id_fkey,
    ADD CONSTRAINT coach_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.coach_conversations(id) ON DELETE CASCADE;

ALTER TABLE public.coach_notes
    DROP CONSTRAINT coach_notes_conversation_id_fkey,
    ADD CONSTRAINT coach_notes_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.coach_conversations(id) ON DELETE CASCADE;

ALTER TABLE public.coach_sessions
    DROP CONSTRAINT coach_sessions_summary_id_fkey,
    ADD CONSTRAINT coach_sessions_summary_id_fkey FOREIGN KEY (summary_id) REFERENCES public.summaries(id) ON DELETE CASCADE;

ALTER TABLE public.community_anonymous_aliases
    DROP CONSTRAINT community_anonymous_aliases_post_id_fkey,
    ADD CONSTRAINT community_anonymous_aliases_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE,
    DROP CONSTRAINT community_anonymous_aliases_user_id_fkey,
    ADD CONSTRAINT community_anonymous_aliases_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.community_blocks
    DROP CONSTRAINT community_blocks_blocked_id_fkey,
    ADD CONSTRAINT community_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id) ON DELETE CASCADE,
    DROP CONSTRAINT community_blocks_blocker_id_fkey,
    ADD CONSTRAINT community_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.community_comments
    DROP CONSTRAINT community_comments_author_id_fkey,
    ADD CONSTRAINT community_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE,
    DROP CONSTRAINT community_comments_post_id_fkey,
    ADD CONSTRAINT community_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE;

ALTER TABLE public.community_post_images
    DROP CONSTRAINT community_post_images_post_id_fkey,
    ADD CONSTRAINT community_post_images_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE,
    DROP CONSTRAINT community_post_images_uploader_id_fkey,
    ADD CONSTRAINT community_post_images_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.community_post_likes
    DROP CONSTRAINT community_post_likes_post_id_fkey,
    ADD CONSTRAINT community_post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE,
    DROP CONSTRAINT community_post_likes_user_id_fkey,
    ADD CONSTRAINT community_post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.community_posts
    DROP CONSTRAINT community_posts_author_id_fkey,
    ADD CONSTRAINT community_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.community_reports
    DROP CONSTRAINT community_reports_reporter_id_fkey,
    ADD CONSTRAINT community_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.entry_ai_reports
    DROP CONSTRAINT entry_ai_reports_entry_id_fkey,
    ADD CONSTRAINT entry_ai_reports_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.challenge_entries(id) ON DELETE CASCADE,
    DROP CONSTRAINT entry_ai_reports_job_id_fkey,
    ADD CONSTRAINT entry_ai_reports_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.ai_jobs(id) ON DELETE CASCADE,
    DROP CONSTRAINT entry_ai_reports_user_id_fkey,
    ADD CONSTRAINT entry_ai_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.entry_comments
    DROP CONSTRAINT entry_comments_entry_id_fkey,
    ADD CONSTRAINT entry_comments_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.challenge_entries(id) ON DELETE CASCADE,
    DROP CONSTRAINT entry_comments_user_id_fkey,
    ADD CONSTRAINT entry_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.entry_likes
    DROP CONSTRAINT entry_likes_entry_id_fkey,
    ADD CONSTRAINT entry_likes_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.challenge_entries(id) ON DELETE CASCADE,
    DROP CONSTRAINT entry_likes_user_id_fkey,
    ADD CONSTRAINT entry_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.entry_ranking_snapshots
    DROP CONSTRAINT entry_ranking_snapshots_viewer_id_fkey,
    ADD CONSTRAINT entry_ranking_snapshots_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.entry_reports
    DROP CONSTRAINT entry_reports_reporter_id_fkey,
    ADD CONSTRAINT entry_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.entry_saves
    DROP CONSTRAINT entry_saves_entry_id_fkey,
    ADD CONSTRAINT entry_saves_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.challenge_entries(id) ON DELETE CASCADE,
    DROP CONSTRAINT entry_saves_user_id_fkey,
    ADD CONSTRAINT entry_saves_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.entry_view_events
    DROP CONSTRAINT entry_view_events_entry_id_fkey,
    ADD CONSTRAINT entry_view_events_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.challenge_entries(id) ON DELETE CASCADE,
    DROP CONSTRAINT entry_view_events_user_id_fkey,
    ADD CONSTRAINT entry_view_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.external_operations
    DROP CONSTRAINT external_operations_session_id_fkey,
    ADD CONSTRAINT external_operations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE,
    DROP CONSTRAINT external_operations_user_id_fkey,
    ADD CONSTRAINT external_operations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.line_memorization
    DROP CONSTRAINT line_memorization_line_id_fkey,
    ADD CONSTRAINT line_memorization_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.script_lines(id) ON DELETE CASCADE,
    DROP CONSTRAINT line_memorization_user_id_fkey,
    ADD CONSTRAINT line_memorization_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.note_ratings
    DROP CONSTRAINT note_ratings_note_id_fkey,
    ADD CONSTRAINT note_ratings_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.coach_notes(id) ON DELETE CASCADE,
    DROP CONSTRAINT note_ratings_practice_id_fkey,
    ADD CONSTRAINT note_ratings_practice_id_fkey FOREIGN KEY (practice_id) REFERENCES public.practices(id) ON DELETE CASCADE,
    DROP CONSTRAINT note_ratings_user_id_fkey,
    ADD CONSTRAINT note_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.notification_pushes
    DROP CONSTRAINT notification_pushes_user_id_fkey,
    ADD CONSTRAINT notification_pushes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
    DROP CONSTRAINT fk_notifications_comment,
    ADD CONSTRAINT fk_notifications_comment FOREIGN KEY (comment_id, entry_id) REFERENCES public.entry_comments(id, entry_id) ON DELETE CASCADE,
    DROP CONSTRAINT fk_notifications_entry,
    ADD CONSTRAINT fk_notifications_entry FOREIGN KEY (entry_id, challenge_id) REFERENCES public.challenge_entries(id, challenge_id) ON DELETE CASCADE,
    DROP CONSTRAINT notifications_actor_user_id_fkey,
    ADD CONSTRAINT notifications_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    DROP CONSTRAINT notifications_user_id_fkey,
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.practice_feedback
    DROP CONSTRAINT practice_feedback_practice_id_fkey,
    ADD CONSTRAINT practice_feedback_practice_id_fkey FOREIGN KEY (practice_id) REFERENCES public.practices(id) ON DELETE CASCADE,
    DROP CONSTRAINT practice_feedback_user_id_fkey,
    ADD CONSTRAINT practice_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.practice_reports
    DROP CONSTRAINT practice_reports_source_handoff_id_fkey,
    ADD CONSTRAINT practice_reports_source_handoff_id_fkey FOREIGN KEY (source_handoff_id) REFERENCES public.coaching_handoffs(id) ON DELETE CASCADE;

ALTER TABLE public.practice_sessions
    DROP CONSTRAINT practice_sessions_upload_intent_id_fkey,
    ADD CONSTRAINT practice_sessions_upload_intent_id_fkey FOREIGN KEY (upload_intent_id) REFERENCES public.upload_intents(id) ON DELETE CASCADE,
    DROP CONSTRAINT practice_sessions_user_id_fkey,
    ADD CONSTRAINT practice_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.practices
    DROP CONSTRAINT practices_root_id_fkey,
    ADD CONSTRAINT practices_root_id_fkey FOREIGN KEY (root_id) REFERENCES public.practices(id) ON DELETE CASCADE,
    DROP CONSTRAINT practices_user_id_fkey,
    ADD CONSTRAINT practices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    DROP CONSTRAINT practices_video_id_fkey,
    ADD CONSTRAINT practices_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;

ALTER TABLE public.reading_recordings
    DROP CONSTRAINT reading_recordings_line_id_fkey,
    ADD CONSTRAINT reading_recordings_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.script_lines(id) ON DELETE CASCADE,
    DROP CONSTRAINT reading_recordings_reading_session_id_fkey,
    ADD CONSTRAINT reading_recordings_reading_session_id_fkey FOREIGN KEY (reading_session_id) REFERENCES public.reading_sessions(id) ON DELETE CASCADE,
    DROP CONSTRAINT reading_recordings_user_id_fkey,
    ADD CONSTRAINT reading_recordings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.reading_session_ratings
    DROP CONSTRAINT reading_session_ratings_session_id_fkey,
    ADD CONSTRAINT reading_session_ratings_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.reading_sessions(id) ON DELETE CASCADE,
    DROP CONSTRAINT reading_session_ratings_user_id_fkey,
    ADD CONSTRAINT reading_session_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.reading_sessions
    DROP CONSTRAINT reading_sessions_current_line_id_fkey,
    ADD CONSTRAINT reading_sessions_current_line_id_fkey FOREIGN KEY (current_line_id) REFERENCES public.script_lines(id) ON DELETE CASCADE,
    DROP CONSTRAINT reading_sessions_end_line_id_fkey,
    ADD CONSTRAINT reading_sessions_end_line_id_fkey FOREIGN KEY (end_line_id) REFERENCES public.script_lines(id) ON DELETE CASCADE,
    DROP CONSTRAINT reading_sessions_script_id_fkey,
    ADD CONSTRAINT reading_sessions_script_id_fkey FOREIGN KEY (script_id) REFERENCES public.scripts(id) ON DELETE CASCADE,
    DROP CONSTRAINT reading_sessions_start_line_id_fkey,
    ADD CONSTRAINT reading_sessions_start_line_id_fkey FOREIGN KEY (start_line_id) REFERENCES public.script_lines(id) ON DELETE CASCADE,
    DROP CONSTRAINT reading_sessions_user_id_fkey,
    ADD CONSTRAINT reading_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.refresh_tokens
    DROP CONSTRAINT refresh_tokens_replaced_by_id_fkey,
    ADD CONSTRAINT refresh_tokens_replaced_by_id_fkey FOREIGN KEY (replaced_by_id) REFERENCES public.refresh_tokens(id) ON DELETE CASCADE,
    DROP CONSTRAINT refresh_tokens_user_id_fkey,
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.script_characters
    DROP CONSTRAINT script_characters_script_id_fkey,
    ADD CONSTRAINT script_characters_script_id_fkey FOREIGN KEY (script_id) REFERENCES public.scripts(id) ON DELETE CASCADE;

ALTER TABLE public.script_imports
    DROP CONSTRAINT script_imports_job_id_fkey,
    ADD CONSTRAINT script_imports_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.ai_jobs(id) ON DELETE CASCADE,
    DROP CONSTRAINT script_imports_user_id_fkey,
    ADD CONSTRAINT script_imports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.script_lines
    DROP CONSTRAINT script_lines_character_id_fkey,
    ADD CONSTRAINT script_lines_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.script_characters(id) ON DELETE CASCADE,
    DROP CONSTRAINT script_lines_script_id_fkey,
    ADD CONSTRAINT script_lines_script_id_fkey FOREIGN KEY (script_id) REFERENCES public.scripts(id) ON DELETE CASCADE;

ALTER TABLE public.script_uploads
    DROP CONSTRAINT script_uploads_user_id_fkey,
    ADD CONSTRAINT script_uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.scripts
    DROP CONSTRAINT scripts_user_id_fkey,
    ADD CONSTRAINT scripts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.upload_intents
    DROP CONSTRAINT upload_intents_user_id_fkey,
    ADD CONSTRAINT upload_intents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    DROP CONSTRAINT upload_intents_video_id_fkey,
    ADD CONSTRAINT upload_intents_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;

ALTER TABLE public.user_blocks
    DROP CONSTRAINT user_blocks_blocked_id_fkey,
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.users(id) ON DELETE CASCADE,
    DROP CONSTRAINT user_blocks_blocker_id_fkey,
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_consents
    DROP CONSTRAINT user_consents_user_id_fkey,
    ADD CONSTRAINT user_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_identities
    DROP CONSTRAINT user_identities_user_id_fkey,
    ADD CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.video_transcripts
    DROP CONSTRAINT video_transcripts_video_id_fkey,
    ADD CONSTRAINT video_transcripts_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;

ALTER TABLE public.videos
    DROP CONSTRAINT videos_user_id_fkey,
    ADD CONSTRAINT videos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.account_cleanup_operations
    ALTER COLUMN user_id DROP NOT NULL,
    DROP CONSTRAINT account_cleanup_operations_user_id_fkey,
    ADD CONSTRAINT account_cleanup_operations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
