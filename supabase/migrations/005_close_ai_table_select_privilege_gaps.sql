-- Close default SELECT privilege gaps on the new AI tables without rewriting 004.

revoke select on public.ai_session_summaries, public.ai_runs, public.actor_corrections, public.interview_turns, public.ai_reports, public.session_deletion_attempts from anon;
revoke select on public.session_deletion_attempts from authenticated;
