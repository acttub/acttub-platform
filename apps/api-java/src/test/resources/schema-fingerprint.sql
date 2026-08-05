-- 스키마를 텍스트 한 뭉치로 정규화한다. alembic 이 만든 스키마와 Flyway V1 이 만든 스키마가
-- 같은지 비교하는 데 쓴다. pg_dump 를 JUnit 안에서 부를 수 없어 카탈로그 조회로 대신한다.
--
-- 제외: flyway_schema_history, alembic_version — 마이그레이션 도구가 각자 만드는 장부이고
-- baseline 자체가 전자를 만들기 때문에 포함하면 기준이 항상 실패한다 (/SPEC.md §5-5).
SELECT line FROM (
    SELECT 'ENUM ' || t.typname || ' = '
           || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS line
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname

    UNION ALL
    SELECT 'TABLE ' || table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('flyway_schema_history', 'alembic_version')

    UNION ALL
    SELECT 'COLUMN ' || table_name || '.' || column_name
           || ' ord=' || ordinal_position
           || ' type=' || udt_name
           || ' len=' || COALESCE(character_maximum_length::text, '-')
           || ' null=' || is_nullable
           || ' default=' || COALESCE(column_default, '-')
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name NOT IN ('flyway_schema_history', 'alembic_version')

    UNION ALL
    SELECT 'CONSTRAINT ' || rel.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
      AND rel.relname NOT IN ('flyway_schema_history', 'alembic_version')

    UNION ALL
    SELECT 'INDEX ' || indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename NOT IN ('flyway_schema_history', 'alembic_version')

    UNION ALL
    SELECT 'SEQUENCE ' || sequence_name || ' type=' || data_type
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
) fingerprint
ORDER BY line
