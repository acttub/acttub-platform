-- Close the pipeline security advisor warnings without changing grants or policies.

alter function public.current_acttub_terms_version() set search_path = public;
alter function public.current_acttub_ai_processing_consent_version() set search_path = public;
alter function public.is_active_acttub_profile(uuid) security invoker;
