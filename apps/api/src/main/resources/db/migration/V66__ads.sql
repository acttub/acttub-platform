-- 앱 광고 칸(SOMA-876). 칸마다 서버가 학원 직접 광고(direct) → 우리 앱 광고(house) → AdMob(앱이 채움) 순으로 하나를 고른다.
-- AdMob 은 이 표에 없다 — 고를 직접·자체 광고가 없으면 응답이 NETWORK 이고 노출·클릭은 AdMob 보고서가 센다.
--
-- ads: 광고 하나가 한 줄. 등록은 처음엔 DB 직접 입력이다(관리 화면 없음). kind 는 direct·house, status 는 active·paused·ended.
--   값 검사는 앱 코드(AdRules)와 저장소 SQL 이 한다(CHECK 없음 — 결제 표와 같은 방식). slots 는 붙일 칸 키 목록(AdSlot).
--   이미지는 규격별 주소다: image_large_banner(320x100)·image_banner(320x50)·image_medium_rectangle(300x250).
--   direct: advertiser_name·academy_registration_no(학원 등록번호)·course_name(교습과정)·tuition(교습비, 추가 경비 포함 문구)·
--     link_url(외부 링크)를 광고 상세 화면이 그대로 보인다. 칸에 맞는 규격 이미지가 있어야 낸다.
--   house: 이미지 또는 headline·body 문구, app_path(앱 안 경로). audience 는 all·free·pro(Pro 권유는 free).
--   starts_at·ends_at 은 비어 있으면 제한 없음. priority 가 큰 것을 먼저 고르고 같으면 사람·날마다 돌린다.
-- ad_events: 직접·자체 광고의 노출과 클릭. 노출은 한 사람·광고·한국 날짜에 한 번(부분 유일 색인), 클릭은 누를 때마다.
--
-- 더하기만 하는 변경이다: 새 표 둘이고 옛 표는 건드리지 않는다. 옛 서버는 이 표를 모른다.
CREATE TABLE public.ads (
    id uuid NOT NULL PRIMARY KEY,
    kind text NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    slots text[] DEFAULT '{}'::text[] NOT NULL,
    audience text DEFAULT 'all' NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    advertiser_name text,
    academy_registration_no text,
    course_name text,
    tuition text,
    headline text,
    body text,
    image_large_banner text,
    image_banner text,
    image_medium_rectangle text,
    link_url text,
    app_path text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX ix_ads_kind_status ON public.ads (kind, status);

CREATE TABLE public.ad_events (
    id uuid NOT NULL PRIMARY KEY,
    ad_id uuid NOT NULL REFERENCES public.ads(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    slot text NOT NULL,
    event text NOT NULL,
    day date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX uq_ad_events_impression ON public.ad_events (ad_id, user_id, day) WHERE event = 'impression';
CREATE INDEX ix_ad_events_ad_day ON public.ad_events (ad_id, event, day);
