-- 찍을 대사 같이 만들기(SOMA-721)의 생성 기록. 생성 요청 하나가 한 줄이다.
--
-- 앱이 감정·상황·원하는 방향을 보내면 서버가 AI 로 대본을 만들어 여기 둔다. 아직 「내 대본」이 아니다 — 배우가 확정하면
-- 기존 대본 저장(scripts·script_characters·script_lines)에 옮기고 script_id 로 잇는다. 대본이 지워지면 연결만 끊긴다.
--
-- conditions 는 생성 조건(경력·감정·상황·방향·결말·소품 등)의 JSON 글, versions 는 버전 배열의 JSON 글이다. versions 가
-- NULL 이면 모델이 아직 만드는 중이다(같은 request_id 의 겹친 요청을 막는 자리). current_version 은 1부터 센 지금 버전이다.
-- revisions_used 는 성공한 수정만 센다(무료 3회). 버전을 되돌려도 줄지 않는다. busy_since 는 수정 중 표시다.
-- 사람이 지워지면 함께 지워진다(ON DELETE CASCADE). 탈퇴의 리딩 파기도 이 표를 지운다.
-- 더하기만 하는 변경이다: 새 표 하나이고 옛 표는 건드리지 않는다. 옛 서버는 이 표를 모른다.
CREATE TABLE public.script_cocreations (
    id uuid NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    conditions text,
    versions text,
    current_version integer DEFAULT 0 NOT NULL,
    revisions_used integer DEFAULT 0 NOT NULL,
    model text,
    busy_since timestamp with time zone,
    script_id uuid REFERENCES public.scripts(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uq_script_cocreations_request UNIQUE (user_id, request_id)
);

CREATE INDEX ix_script_cocreations_user ON public.script_cocreations (user_id, created_at DESC);
