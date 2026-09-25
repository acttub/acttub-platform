-- 1.0.0 데이터 전환의 대응표 (SOMA-546, 02-practice 「1.0.0 스키마 전환」 ③).
--
-- ⚠️ 이 파일도 넓히기만 한다(V9·V14 머리말과 같은 규칙). 새 테이블 하나뿐이라 직전 운영 태그의 서버가
-- 모르는 것이고 되돌려도 그 서버가 그대로 뜬다(Hibernate 의 `validate` 는 여분 테이블을 보지 않는다).
--
-- 🔥 <b>옛 테이블은 여기서도 건드리지 않는다.</b> 전환은 Flyway 가 아니라 재실행 가능한 애플리케이션
-- 명령이고, 이 표는 그 명령이 "무엇을 무엇으로 옮겼는지"와 "무엇을 왜 옮기지 않았는지"를 남기는 자리다.
-- 명령이 멱등한 것은 이 표 덕분이다 — 한 번 적힌 원본은 다시 고르지 않는다.
--
-- 옮기지 않은 자료는 `target_id` 가 NULL 이고 `skip_reason` 이 이유를 든다. <b>임의로 닫거나 지우지
-- 않는다</b> — 그 자료는 호환 읽기 경로가 옛 테이블에서 그대로 읽는다(02-practice).
CREATE TABLE public.practice_migration_entries (
    id uuid NOT NULL,
    step text NOT NULL,
    source_table text NOT NULL,
    source_id uuid NOT NULL,
    target_id uuid,
    skip_reason text,
    batch_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT practice_migration_entries_pkey PRIMARY KEY (id),
    -- 같은 원본을 두 번 고르지 않는다 — 명령의 멱등이 여기서 나온다.
    CONSTRAINT uq_practice_migration_source UNIQUE (source_table, source_id)
);

-- 명령은 단계별로 남은 것을 찾고, 운영은 건너뛴 사유를 단계별로 센다.
CREATE INDEX idx_practice_migration_step
    ON public.practice_migration_entries USING btree (step, created_at);
