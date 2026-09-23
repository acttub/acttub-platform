-- 참여작 조회수와 좋아요순 커서(challenge.browse). 기존 표는 바꾸지 않는다.

-- 3초 재생 사건 하나가 조회수 1이다. 같은 사건 id 는 한 번만 반영하고 7일 뒤 지운다.
CREATE TABLE public.entry_view_events (
    event_id uuid PRIMARY KEY,
    entry_id uuid NOT NULL REFERENCES public.challenge_entries(id),
    user_id uuid NOT NULL REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX ix_entry_view_events_created ON public.entry_view_events(created_at);

-- 좋아요순 첫 조회의 순서를 10분 동안 그대로 이어 준다. 순위는 전체 기준이고 0은 순위 없음이다.
-- basis 가 바뀌면(진행 중 → 마감 집계 → 확정) 커서는 만료된다.
CREATE TABLE public.entry_ranking_snapshots (
    id uuid PRIMARY KEY,
    challenge_id uuid NOT NULL REFERENCES public.challenges(id),
    viewer_id uuid NOT NULL REFERENCES public.users(id),
    basis text NOT NULL,
    entry_ids uuid[] NOT NULL,
    ranks integer[] NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_entry_ranking_snapshots_basis CHECK (basis IN ('live','pending','final')),
    CONSTRAINT ck_entry_ranking_snapshots_shape CHECK (cardinality(entry_ids)=cardinality(ranks))
);
CREATE INDEX ix_entry_ranking_snapshots_created ON public.entry_ranking_snapshots(created_at);
