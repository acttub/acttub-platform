-- 광고 칸을 화면별로 끄는 스위치(SOMA-876). 앱 빌드 없이 칸 하나만 비울 때 쓴다.
-- 줄이 없거나 enabled=true 면 켜진 것이다(새 칸은 줄을 안 넣어도 켜진다). enabled=false 면 그 칸은 누구에게나 NONE 이라
-- 학원·우리 앱 광고도, AdMob 도 나오지 않는다. 전체를 끄는 ADS_ENABLED=false 와 함께 쓰며 둘 중 하나라도 끄면 꺼진다.
-- 예: UPDATE ad_slot_switches SET enabled=false, updated_at=now() WHERE slot_key IN ('home_top','settings_top');
--
-- 더하기만 하는 변경이다: 새 표 하나이고 옛 표는 건드리지 않는다. 옛 서버는 이 표를 모른다.
CREATE TABLE public.ad_slot_switches (
    slot_key text NOT NULL PRIMARY KEY,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 지금 있는 칸을 모두 켠 채로 미리 넣어 둔다 — 운영에서 UPDATE 한 줄로 끄고 켤 수 있게.
INSERT INTO public.ad_slot_switches (slot_key) VALUES
    ('auditions_top'),
    ('admissions_top'),
    ('admission_detail_top'),
    ('reading_tab_top'),
    ('challenges_tab_top'),
    ('challenge_detail_top'),
    ('archive_top'),
    ('saved_videos_top'),
    ('home_top'),
    ('profile_top'),
    ('settings_top'),
    ('analyzing_top'),
    ('report_top'),
    ('notifications_top'),
    ('line_search_top'),
    ('analyzing_wait'),
    ('voice_prepare_wait'),
    ('upload_wait'),
    ('script_parse_wait'),
    ('coaching_done'),
    ('challenge_upload_done'),
    ('community_list_top'),
    ('community_post_top')
ON CONFLICT (slot_key) DO NOTHING;
