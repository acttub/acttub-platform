-- ops.acttub.com 코어 지표 한 벌 (GET /v2/admin/ops-core).
--
-- 정본은 ops 수집기 coo001/soma 도구/ops-snapshot.py 의 CORE_SQL 이다(456ff83 기준으로 옮김).
-- 수집기는 이 SQL 을 하루 한 번 뜨는 S3 백업(04:00 KST)을 임시 Postgres 에 복원해서 돌렸다.
-- 그래서 화면 숫자가 최대 하루 늦었다. 같은 SQL 을 운영 DB 에서 바로 돌려 지금 값을 준다.
--
-- 바뀐 것은 셋뿐이다. 나머지 글자는 정본과 같다 — 고칠 때는 두 곳을 같이 고친다.
--   1. 맨 앞 SET 두 줄을 뺐다. 읽기 전용·시간 제한은 저장소가 트랜잭션에 건다.
--   2. psql 변수 excl 을 JDBC 위치 바인드로 바꿨다. 바인드 자리는 team CTE 두 곳뿐이다
--      (① 팀 이메일 목록, ② 팀 배우 가명 목록 — 아래 5).
--   3. 이 머리말.
--   4. 1.0 연습 테이블을 함께 읽는다(SOMA-566) — 아래 "1.0 전환" CTE 다섯 개.
--   5. 팀을 가명으로도 뺀다(SOMA-569). 게스트는 이메일이 없어 ① 로는 못 거른다 — 화면의 "배우 xxxxxxxx"
--      8자리(md5(user_id) 앞 8자리)를 쉼표로 받는다. 비면 아무도 더 안 빠진다.
--   6. 기능별 사용('features' — 대본 리딩·챌린지·노트 평가·이탈 설문·커뮤니티·계정, SOMA-570). 수집기 정본에는 없다.
-- now() 는 트랜잭션 시작 시각이다. 백업 경로는 이것을 백업 시각으로 바꿔 돌렸다.
WITH b AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS d),
-- 분석 기준 셋. '어제'(달력)가 아니라 '최근 24시간'(구르는 창)이다 —
-- 화면에서 세 기준을 바꿔 가며 보므로 창이 같은 방식이어야 비교가 된다.
w AS (SELECT now() - interval '24 hours' AS h24, now() - interval '7 days' AS d7),
bases(basis, since) AS (
  SELECT 'h24', (SELECT h24 FROM w)
  UNION ALL SELECT 'd7', (SELECT d7 FROM w)
  UNION ALL SELECT 'all', '-infinity'::timestamptz
),
-- 팀 계정 제외 목록은 ADMIN_OPS_EXCLUDE_EMAILS(쉼표 구분, 유일한 바인드 값)를 users와 대조해 한 번만 만든다.
team AS (
  SELECT id FROM users
  WHERE lower(email) = ANY(
    SELECT btrim(e) FROM unnest(string_to_array(lower(?), ',')) AS e)
     OR left(md5(id::text), 8) = ANY(string_to_array(?, ','))
),
-- ── 1.0 전환 (SOMA-566) ─────────────────────────────────────────────
-- 1.0 부터 연습은 practices · analyses · coach_conversations · coach_messages · ai_jobs 에 쌓인다.
-- 옛 테이블(practice_sessions · summaries · coach_sessions · coach_turns · external_operations)은 남아 있고,
-- 이관 명령(POST /v2/admin/practice-migration)이 옛 행을 <b>같은 id 로</b> 새 테이블에 옮긴다
-- (practices.id = practice_sessions.id, coach_conversations.id = coach_sessions.id). 그래서
-- "새 테이블 전부 + 새 테이블에 아직 없는 옛 행"은 이관 전·중·후 어느 때에도 한 번씩만 센다.
-- 요약·작업은 새 id 로 옮겨지므로 이관 대응표(practice_migration_entries)로 옮겨진 옛 행을 뺀다.
--
-- 옛 행의 모양은 이 파일의 이전 쿼리가 쓰던 그대로다 — 1.0 이전 숫자는 바뀌지 않는다.
ps_all AS (
  SELECT p.id, p.user_id, p.created_at,
         CASE WHEN p.close_reason = 'analysis_failed' THEN 'failed'
              WHEN EXISTS (SELECT 1 FROM analyses a WHERE a.practice_id = p.id) THEN 'analyzed'
              ELSE p.stage END AS status,
         p.blockage_kind,
         p.ordinal > 1 AS continued
  FROM practices p
  UNION ALL
  SELECT ps.id, ps.user_id, ps.created_at, ps.status::text, ps.blockage_kind,
         ps.continued_from IS NOT NULL
  FROM practice_sessions ps
  WHERE NOT EXISTS (SELECT 1 FROM practices p WHERE p.id = ps.id)
),
analysis_all AS (
  SELECT a.id, a.practice_id AS session_id, a.created_at, a.model, false AS was_compressed
  FROM analyses a
  UNION ALL
  SELECT s.id, s.session_id, s.created_at, s.model, s.was_compressed
  FROM summaries s
  WHERE NOT EXISTS (SELECT 1 FROM practice_migration_entries e
                    WHERE e.source_table = 'summaries' AND e.source_id = s.id AND e.target_id IS NOT NULL)
),
-- 코치 대화 전부(요약 여부와 무관). 옛 행의 주인은 예전처럼 summaries → practice_sessions 로 찾는다.
conv_all AS (
  SELECT c.id, c.practice_id, c.status, c.close_reason, c.created_at, p.user_id
  FROM coach_conversations c
  JOIN practices p ON p.id = c.practice_id
  UNION ALL
  SELECT cs.id, cs.practice_session_id, cs.status::text, cs.close_reason::text, cs.created_at, ps.user_id
  FROM coach_sessions cs
  LEFT JOIN summaries s ON s.id = cs.summary_id
  LEFT JOIN practice_sessions ps ON ps.id = s.session_id
  WHERE NOT EXISTS (SELECT 1 FROM coach_conversations c WHERE c.id = cs.id)
),
turn_all AS (
  SELECT m.conversation_id AS session_id, m.role, m.created_at
  FROM coach_messages m
  UNION ALL
  SELECT t.session_id, t.role::text, t.created_at
  FROM coach_turns t
  WHERE NOT EXISTS (SELECT 1 FROM coach_conversations c WHERE c.id = t.session_id)
),
op_all AS (
  SELECT j.kind, j.status, j.attempt_count, j.created_at, j.target_id AS session_id
  FROM ai_jobs j
  UNION ALL
  SELECT o.kind::text, o.status::text, o.attempt_count, o.created_at, o.session_id
  FROM external_operations o
  WHERE NOT EXISTS (SELECT 1 FROM practice_migration_entries e
                    WHERE e.source_table = 'external_operations' AND e.source_id = o.id AND e.target_id IS NOT NULL)
),
-- 기기 판별의 유일한 단서는 refresh_tokens.device_info(요청의 User-Agent)다.
-- 업로드 시점 기기는 어디에도 저장되지 않는다.
--
-- 두 기준은 정확도가 다르다 — 화면에서 절대 섞지 않는다.
--   · 가입 기준: 가입 요청이 그 자리에서 첫 토큰을 발급하므로 **정확**하다
--     (실측 2026-08-01: 144명 전원 users.created_at 과 첫 토큰 issued_at 차이 0초).
--   · 세션 입력 기준: 세션 시각에 **시간상 가장 가까운** 토큰을 붙인 근사.
--     access token 이 30분마다 회전해 실사용 중이면 몇 분 안에 토큰이 새로
--     찍힌다(실측: 팀 제외 27건 평균 5분, 최악 15분). 그래도 다기기 사용자는
--     틀릴 수 있어 gap 과 다기기 여부를 같이 내보낸다.
--
-- okhttp = 안드로이드 앱, `Acttub/<빌드> CFNetwork/... Darwin/...` = iOS 앱.
-- iOS 앱 UA 에는 'iPhone' 이 없어서 예전 분류기는 이걸 '기타'로 흘렸다.
classified AS (
  SELECT rt.user_id, rt.issued_at,
    -- 체인 머리 = 아무도 replaced_by_id 로 가리키지 않는 행 = 진짜 로그인.
    -- 나머지는 30분마다 도는 자동 회전이라 로그인으로 세면 안 된다.
    NOT EXISTS (SELECT 1 FROM refresh_tokens p WHERE p.replaced_by_id = rt.id) AS is_login,
    CASE
      WHEN rt.device_info ILIKE '%CFNetwork%' AND rt.device_info ILIKE '%Darwin%' THEN 'iOS 앱'
      WHEN rt.device_info ILIKE '%okhttp%' THEN '안드로이드 앱'
      WHEN rt.device_info ILIKE '%iPhone%' THEN '아이폰'
      WHEN rt.device_info ILIKE '%iPad%' THEN '아이패드'
      WHEN rt.device_info ILIKE '%Android%' AND rt.device_info ILIKE '%Mobile%' THEN '안드로이드 폰'
      WHEN rt.device_info ILIKE '%Android%' THEN '안드로이드 태블릿'
      WHEN rt.device_info ILIKE '%Macintosh%' THEN '맥'
      WHEN rt.device_info ILIKE '%Windows%' THEN '윈도우'
      ELSE '기타'
    END AS device,
    -- ⚠️ 인앱 판별은 iOS 에서만 믿을 만하다. iOS 인스타는 자체 웹뷰라 UA 끝에
    -- 'Instagram' 이 붙지만, 안드로이드는 크롬 커스텀탭·삼성 인터넷으로 열려
    -- 흔적이 남지 않는다(실측: iOS 79명 중 63명 vs 안드 56명 중 12명).
    -- 안드로이드 인앱 비율은 과소집계다 — 화면에 그렇게 적는다.
    CASE
      WHEN rt.device_info ILIKE '%okhttp%'
        OR (rt.device_info ILIKE '%CFNetwork%' AND rt.device_info ILIKE '%Darwin%') THEN '네이티브 앱'
      WHEN rt.device_info ILIKE '%Instagram%' THEN '인스타 인앱'
      WHEN rt.device_info ILIKE '%KAKAOTALK%' THEN '카톡 인앱'
      WHEN rt.device_info ILIKE '%FBAN%' OR rt.device_info ILIKE '%FBAV%' THEN '페북 인앱'
      WHEN rt.device_info ILIKE '%NAVER(inapp%' THEN '네이버 인앱'
      WHEN rt.device_info ILIKE '%GSA/%' THEN '구글앱 인앱'
      WHEN rt.device_info ILIKE '%; wv)%' THEN '기타 인앱'
      ELSE '일반 브라우저'
    END AS browser
  FROM refresh_tokens rt
  WHERE rt.device_info IS NOT NULL AND rt.device_info <> ''
),
signup_device AS (
  SELECT u.id AS user_id, u.created_at,
         COALESCE(f.device, '기록 없음') AS device,
         COALESCE(f.browser, '기록 없음') AS browser,
         (u.id IN (SELECT id FROM team)) AS is_team
  FROM users u
  LEFT JOIN LATERAL (
    SELECT c.device, c.browser FROM classified c
    WHERE c.user_id = u.id ORDER BY c.issued_at ASC LIMIT 1
  ) f ON TRUE
),
-- 네이티브 앱은 반드시 okhttp/CFNetwork UA 토큰을 남기므로 '기록 없음'은 웹으로 흘린다(2026-08-24 실측 '기록 없음' 0명).
signup_platform AS (
  SELECT user_id,
         CASE WHEN device IN ('iOS 앱', '안드로이드 앱') THEN '앱' ELSE '웹' END AS platform
  FROM signup_device
),
scopes AS (
  SELECT b.basis, b.since, p.platform
  FROM bases b
  CROSS JOIN (VALUES ('전체'), ('앱'), ('웹')) AS p(platform)
),
events AS (
  SELECT '가입자' AS label, 1 AS ord, u.created_at, u.id AS user_id FROM users u
  UNION ALL SELECT '연습 세션', 2, ps.created_at, ps.user_id FROM ps_all ps
  UNION ALL SELECT '코치 대화', 3, cv.created_at, cv.user_id FROM conv_all cv
  UNION ALL SELECT '코치 발화', 4, ta.created_at, cv.user_id
    FROM turn_all ta
    LEFT JOIN conv_all cv ON cv.id = ta.session_id
  UNION ALL SELECT '분석 요약', 5, an.created_at, ps.user_id
    FROM analysis_all an
    LEFT JOIN ps_all ps ON ps.id = an.session_id
),
rolled AS (
  SELECT label, ord,
         count(*) FILTER (WHERE created_at > (SELECT h24 FROM w)) AS h24,
         count(*) FILTER (WHERE created_at > (SELECT h24 FROM w) AND t.id IS NULL) AS h24_real,
         count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)) AS d7,
         count(*) FILTER (WHERE created_at > (SELECT d7 FROM w) AND t.id IS NULL) AS d7_real,
         count(*) AS total,
         count(*) FILTER (WHERE t.id IS NULL) AS total_real
  FROM events e
  LEFT JOIN team t ON t.id = e.user_id
  GROUP BY label, ord
),
-- 코치 대화에는 user_id 가 없다. 1.0 은 practices 로, 옛 행은 summaries → practice_sessions 를 거쳐야
-- 주인을 안다(옛 행은 예전처럼 요약이 붙은 대화만).
chat AS (
  SELECT c.id, c.status, c.close_reason, c.created_at, p.user_id
  FROM coach_conversations c
  JOIN practices p ON p.id = c.practice_id
  UNION ALL
  SELECT cs.id, cs.status::text, cs.close_reason::text, cs.created_at, ps.user_id
  FROM coach_sessions cs
  JOIN summaries s ON s.id = cs.summary_id
  JOIN practice_sessions ps ON ps.id = s.session_id
  WHERE NOT EXISTS (SELECT 1 FROM coach_conversations c WHERE c.id = cs.id)
),
-- 퍼널은 **코호트**다: 그 기간에 가입한 사람들이 어디까지 갔는가.
-- 기간 안의 '활동'을 세면 옛 사용자의 세션이 섞여 뒷단계가 앞단계보다 커지고
-- 퍼널이 거꾸로 보인다. 마지막 칸 'gap_stated' 가 제품이 성공했다고 말할 수
-- 있는 유일한 지점이다 — 배우가 스스로 빈틈을 문장으로 남기고 대화가 닫힌 경우.
-- LATERAL 이라 값이 0 인 조합도 행이 남는다(빠진 칸이 생기지 않는다).
funnel AS (
  SELECT sc.basis, sc.platform, s.ord, s.step, s.users, s.users_real
  FROM scopes sc,
  LATERAL (
    SELECT 1 AS ord, '가입' AS step, count(*) AS users,
           count(*) FILTER (WHERE t.id IS NULL) AS users_real
      FROM users u
      JOIN signup_platform sp ON sp.user_id = u.id
        AND (sc.platform = '전체' OR sp.platform = sc.platform)
      LEFT JOIN team t ON t.id = u.id
      WHERE u.created_at > sc.since
    UNION ALL
    SELECT 2, '업로드 확정', count(DISTINCT u.id),
           count(DISTINCT u.id) FILTER (WHERE t.id IS NULL) AS users_real
      FROM users u JOIN upload_intents ui ON ui.user_id = u.id AND ui.status = 'finalized'
      JOIN signup_platform sp ON sp.user_id = u.id
        AND (sc.platform = '전체' OR sp.platform = sc.platform)
      LEFT JOIN team t ON t.id = u.id
      WHERE u.created_at > sc.since
    UNION ALL
    SELECT 3, '연습 세션', count(DISTINCT u.id),
           count(DISTINCT u.id) FILTER (WHERE t.id IS NULL) AS users_real
      FROM users u JOIN ps_all ps ON ps.user_id = u.id
      JOIN signup_platform sp ON sp.user_id = u.id
        AND (sc.platform = '전체' OR sp.platform = sc.platform)
      LEFT JOIN team t ON t.id = u.id
      WHERE u.created_at > sc.since
    UNION ALL
    SELECT 4, '분석 완료', count(DISTINCT u.id),
           count(DISTINCT u.id) FILTER (WHERE t.id IS NULL) AS users_real
      FROM users u JOIN ps_all ps ON ps.user_id = u.id AND ps.status = 'analyzed'
      JOIN signup_platform sp ON sp.user_id = u.id
        AND (sc.platform = '전체' OR sp.platform = sc.platform)
      LEFT JOIN team t ON t.id = u.id
      WHERE u.created_at > sc.since
    UNION ALL
    SELECT 5, '코치 대화', count(DISTINCT u.id),
           count(DISTINCT u.id) FILTER (WHERE t.id IS NULL) AS users_real
      FROM users u JOIN chat c ON c.user_id = u.id
      JOIN signup_platform sp ON sp.user_id = u.id
        AND (sc.platform = '전체' OR sp.platform = sc.platform)
      LEFT JOIN team t ON t.id = u.id
      WHERE u.created_at > sc.since
    UNION ALL
    SELECT 6, '대화 마무리', count(DISTINCT u.id),
           count(DISTINCT u.id) FILTER (WHERE t.id IS NULL) AS users_real
      FROM users u JOIN chat c ON c.user_id = u.id AND c.status = 'closed'
      JOIN signup_platform sp ON sp.user_id = u.id
        AND (sc.platform = '전체' OR sp.platform = sc.platform)
      LEFT JOIN team t ON t.id = u.id
      WHERE u.created_at > sc.since
    UNION ALL
    -- status 도 같이 본다. close_reason 과 status 를 묶는 제약이 DB 에 없어서,
    -- 이상 행이 하나 생기면 7단계가 6단계보다 커진다.
    SELECT 7, '놓친 생각 말함', count(DISTINCT u.id),
           count(DISTINCT u.id) FILTER (WHERE t.id IS NULL) AS users_real
      FROM users u JOIN chat c ON c.user_id = u.id
        AND c.close_reason = 'gap_stated' AND c.status = 'closed'
      JOIN signup_platform sp ON sp.user_id = u.id
        AND (sc.platform = '전체' OR sp.platform = sc.platform)
      LEFT JOIN team t ON t.id = u.id
      WHERE u.created_at > sc.since
  ) s
),
turns AS (SELECT session_id, count(*) AS t FROM turn_all GROUP BY session_id),
calendar_days AS (
  SELECT day::date AS date
  FROM generate_series(
    (SELECT d - 41 FROM b)::timestamp,
    (SELECT d FROM b)::timestamp,
    interval '1 day'
  ) AS days(day)
),
first_session_days AS (
  SELECT user_id,
         min((created_at AT TIME ZONE 'Asia/Seoul')::date) AS first_date
  FROM ps_all
  GROUP BY user_id
),
daily_session_users AS (
  SELECT DISTINCT user_id,
         (created_at AT TIME ZONE 'Asia/Seoul')::date AS date
  FROM ps_all
  WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date
        BETWEEN (SELECT d - 41 FROM b) AND (SELECT d FROM b)
),
daily_signups AS (
  SELECT (u.created_at AT TIME ZONE 'Asia/Seoul')::date AS date,
         count(*) AS signups,
         count(*) FILTER (WHERE t.id IS NULL) AS signups_real,
         count(*) FILTER (WHERE t.id IS NULL AND sp.platform = '앱') AS signups_app_real
  FROM users u
  JOIN signup_platform sp ON sp.user_id = u.id
  LEFT JOIN team t ON t.id = u.id
  WHERE (u.created_at AT TIME ZONE 'Asia/Seoul')::date
        BETWEEN (SELECT d - 41 FROM b) AND (SELECT d FROM b)
  GROUP BY 1
),
-- 그날 코치 대화를 시작한 사람. chat 은 요약·연습 세션이 이어진 코치 세션만이라
-- 퍼널의 '코치 대화' 칸과 같은 정의다. 날짜별로 미리 세어 daily_active 에 붙인다.
daily_coach AS (
  SELECT c.date,
         count(DISTINCT c.user_id) AS coach,
         count(DISTINCT c.user_id) FILTER (WHERE t.id IS NULL) AS coach_real
  FROM (
    SELECT user_id, (created_at AT TIME ZONE 'Asia/Seoul')::date AS date
    FROM chat
  ) c
  LEFT JOIN team t ON t.id = c.user_id
  WHERE c.date BETWEEN (SELECT d - 41 FROM b) AND (SELECT d FROM b)
  GROUP BY 1
),
daily_active AS (
  SELECT d.date,
         count(DISTINCT s.user_id) AS active,
         count(DISTINCT s.user_id) FILTER (WHERE t.id IS NULL) AS active_real,
         count(DISTINCT s.user_id) FILTER (
           WHERE t.id IS NULL AND sp.platform = '앱'
         ) AS active_app_real,
         count(DISTINCT s.user_id) FILTER (WHERE f.first_date < d.date) AS returning_users,
         count(DISTINCT s.user_id) FILTER (
           WHERE f.first_date < d.date AND t.id IS NULL
         ) AS returning_real,
         COALESCE(g.signups, 0) AS signups,
         COALESCE(g.signups_real, 0) AS signups_real,
         COALESCE(g.signups_app_real, 0) AS signups_app_real,
         COALESCE(k.coach, 0) AS coach,
         COALESCE(k.coach_real, 0) AS coach_real
  FROM calendar_days d
  LEFT JOIN daily_session_users s ON s.date = d.date
  LEFT JOIN first_session_days f ON f.user_id = s.user_id
  LEFT JOIN signup_platform sp ON sp.user_id = s.user_id
  LEFT JOIN team t ON t.id = s.user_id
  LEFT JOIN daily_signups g ON g.date = d.date
  LEFT JOIN daily_coach k ON k.date = d.date
  GROUP BY d.date, g.signups, g.signups_real, g.signups_app_real, k.coach, k.coach_real
),
-- S13 목표(SOMA-509). 다음 스프린트에 날짜·목표를 여기서 고친다.
sprint_goal_daily AS (
  SELECT d.date,
         count(DISTINCT c.user_id) FILTER (WHERE c.date = d.date) AS dau,
         count(DISTINCT c.user_id) FILTER (
           WHERE c.date BETWEEN d.date - 6 AND d.date
         ) AS wau,
         count(c.id) FILTER (
           WHERE c.date BETWEEN DATE '2026-09-07' AND d.date
         ) AS coach_sessions_cum
  FROM (
    SELECT day::date AS date
    FROM generate_series(
      DATE '2026-09-07'::timestamp,
      least(
        (now() AT TIME ZONE 'Asia/Seoul')::date,
        DATE '2026-09-20'
      )::timestamp,
      interval '1 day'
    ) AS days(day)
  ) d
  LEFT JOIN (
    SELECT c.id, c.user_id,
           (c.created_at AT TIME ZONE 'Asia/Seoul')::date AS date
    FROM chat c
    LEFT JOIN team t ON t.id = c.user_id
    WHERE t.id IS NULL
  ) c ON c.date BETWEEN least(DATE '2026-09-07', d.date - 6) AND d.date
  GROUP BY d.date
),
session_device AS (
  SELECT ps.id, ps.created_at,
         COALESCE(n.device, '기록 없음') AS device,
         COALESCE(n.browser, '기록 없음') AS browser,
         n.gap_sec,
         COALESCE(uc.n_dev, 0) > 1 AS multi_device,
         (ps.user_id IN (SELECT id FROM team)) AS is_team
  FROM ps_all ps
  LEFT JOIN LATERAL (
    -- UA 문자열 종류를 세면 같은 폰도 OS·브라우저 업데이트마다 새 기기가 된다.
    -- 분류된 기기로 센다. 반대로 okhttp 는 기종을 안 알려줘서 서로 다른
    -- 안드로이드 폰이 한 기기로 뭉치는 건 못 잡는다 — 이 숫자는 하한이다.
    SELECT count(DISTINCT c.device) AS n_dev FROM classified c WHERE c.user_id = ps.user_id
  ) uc ON TRUE
  LEFT JOIN LATERAL (
    SELECT c.device, c.browser,
           abs(EXTRACT(epoch FROM (c.issued_at - ps.created_at))) AS gap_sec
    FROM classified c WHERE c.user_id = ps.user_id
    ORDER BY abs(EXTRACT(epoch FROM (c.issued_at - ps.created_at))) ASC LIMIT 1
  ) n ON TRUE
)
SELECT json_build_object(
  'metrics', (
    SELECT json_agg(json_build_object(
      'label', label,
      'h24', h24, 'h24_real', h24_real,
      'd7', d7, 'd7_real', d7_real,
      'total', total, 'total_real', total_real
    ) ORDER BY ord) FROM rolled
  ),
  'funnels', (SELECT json_object_agg(basis, steps) FROM (
      SELECT basis, json_agg(json_build_object(
        'step', step, 'users', users, 'users_real', users_real) ORDER BY ord) AS steps
      FROM funnel WHERE platform = '전체' GROUP BY basis) f),
  'funnels_by_platform', (SELECT json_object_agg(basis, platforms) FROM (
      SELECT basis, json_object_agg(platform, steps) AS platforms
      FROM (
        SELECT basis, platform, json_agg(json_build_object(
          'ord', ord, 'step', step, 'users', users, 'users_real', users_real
        ) ORDER BY ord) AS steps
        FROM funnel WHERE platform IN ('앱', '웹') GROUP BY basis, platform
      ) p GROUP BY basis) f),
  'gap_stated', (SELECT json_build_object(
      'h24', count(*) FILTER (WHERE created_at > (SELECT h24 FROM w)),
      'd7',  count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)),
      'all', count(*))
      FROM chat WHERE close_reason = 'gap_stated' AND status = 'closed'),
  'close_reasons', (SELECT json_agg(json_build_object('reason', reason, 'count', c) ORDER BY c DESC) FROM (
      SELECT COALESCE(close_reason::text,
                      CASE WHEN status = 'open' THEN '진행 중' ELSE '사유 없음' END) AS reason,
             count(*) AS c
      FROM chat GROUP BY 1) y),
  'turns', (SELECT json_build_object(
      'sessions', count(*), 'avg', round(avg(t), 1), 'max', max(t),
      'deep', count(*) FILTER (WHERE t >= 6)) FROM turns),
  'returning', (SELECT json_build_object(
      'with_session', count(*), 'twice', count(*) FILTER (WHERE n >= 2),
      'thrice', count(*) FILTER (WHERE n >= 3))
      FROM (SELECT user_id, count(*) n FROM ps_all GROUP BY 1) r),
  'daily_active', (SELECT json_agg(json_build_object(
      'date', to_char(date, 'YYYY-MM-DD'),
      'active', active, 'active_real', active_real, 'active_app_real', active_app_real,
      'returning', returning_users, 'returning_real', returning_real,
      'signups', signups, 'signups_real', signups_real, 'signups_app_real', signups_app_real,
      'coach', coach, 'coach_real', coach_real
    ) ORDER BY date) FROM daily_active),
  'sprint_goal', json_build_object(
    'sprint', 'S13',
    'start', '2026-09-07', 'end', '2026-09-20',
    'targets', json_build_object('dau', 10, 'wau', 100, 'coach_sessions', 150),
    'basis_date', to_char(
      least(
        (now() AT TIME ZONE 'Asia/Seoul')::date - 1,
        DATE '2026-09-20'
      ),
      'YYYY-MM-DD'
    ),
    'dau', (SELECT dau FROM sprint_goal_daily
      WHERE date = least(
        (now() AT TIME ZONE 'Asia/Seoul')::date - 1,
        DATE '2026-09-20'
      )),
    'wau', (SELECT wau FROM sprint_goal_daily
      WHERE date = least(
        (now() AT TIME ZONE 'Asia/Seoul')::date - 1,
        DATE '2026-09-20'
      )),
    'coach_sessions', (SELECT coach_sessions_cum FROM sprint_goal_daily
      WHERE date = least(
        (now() AT TIME ZONE 'Asia/Seoul')::date - 1,
        DATE '2026-09-20'
      )),
    'daily', (SELECT COALESCE(json_agg(json_build_object(
      'date', to_char(date, 'YYYY-MM-DD'),
      'dau', dau,
      'wau', wau,
      'coach_sessions_cum', coach_sessions_cum
    ) ORDER BY date), '[]'::json) FROM sprint_goal_daily)
  ),
  -- 과거 실패가 계속 경고되지 않도록 최근 24시간 건수를 함께 낸다.
  'operations', (SELECT json_agg(json_build_object(
      'kind', kind, 'status', status, 'count', c, 'attempts', att, 'h24', h24) ORDER BY kind, status) FROM (
      SELECT kind::text AS kind, status::text AS status, count(*) AS c, round(avg(attempt_count), 2) AS att,
             count(*) FILTER (WHERE created_at > (SELECT h24 FROM w)) AS h24
      FROM op_all GROUP BY 1, 2) o),
  'uploads', (SELECT json_agg(json_build_object('status', status, 'count', c) ORDER BY c DESC) FROM (
      SELECT status::text AS status, count(*) AS c FROM upload_intents GROUP BY 1) u),
  -- 앱 카드 분석 흐름을 GA4 대신 운영 DB로 그린다 — dev 빌드 이벤트 혼입 차단.
  'app_analysis_daily', (SELECT json_agg(json_build_object(
      'date', gs.day::date, 'start', coalesce(t.total,0), 'complete', coalesce(t.ok,0), 'failed', coalesce(t.ko,0)) ORDER BY gs.day)
    FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date - 6, (now() AT TIME ZONE 'Asia/Seoul')::date, interval '1 day') AS gs(day)
    LEFT JOIN (
      SELECT (eo.created_at AT TIME ZONE 'Asia/Seoul')::date AS d,
             count(*) AS total,
             count(*) FILTER (WHERE eo.status::text='succeeded') AS ok,
             count(*) FILTER (WHERE eo.status::text='failed') AS ko
      FROM op_all eo
      JOIN ps_all ps ON ps.id = eo.session_id
      JOIN LATERAL (
        SELECT rt.device_info FROM refresh_tokens rt
        WHERE rt.user_id = ps.user_id
        ORDER BY abs(extract(epoch from rt.issued_at - ps.created_at)) LIMIT 1
      ) di ON TRUE
      WHERE eo.kind::text='analyze'
        AND (di.device_info ILIKE '%okhttp%' OR (di.device_info ILIKE '%CFNetwork%' AND di.device_info ILIKE '%Darwin%'))
      GROUP BY 1
    ) t ON t.d = gs.day::date),
  'providers', (SELECT json_agg(json_build_object('provider', provider, 'count', c) ORDER BY c DESC) FROM (
      SELECT provider::text AS provider, count(*) AS c FROM user_identities GROUP BY 1) p),
  'models', (SELECT json_agg(json_build_object('model', model, 'count', c, 'compressed', z) ORDER BY c DESC) FROM (
      SELECT COALESCE(model, '(미기록)') AS model, count(*) AS c,
             count(*) FILTER (WHERE was_compressed) AS z
      FROM analysis_all GROUP BY 1) m),
  'observations', (SELECT json_build_object(
      'total', count(*),
      'per_summary', round(count(*)::numeric / GREATEST(1, (SELECT count(*) FROM summaries)), 1))
      FROM anomalies),
  -- 기기는 **가입 기준**과 **세션 입력 기준** 두 벌을 따로 낸다. 하나로 합치면
  -- "정확한 값"과 "근사"가 같은 표에 섞여 둘 다 못 믿게 된다.
  -- 숫자는 전체(all)와 팀 제외(real)를 나란히 담는다 — 조용히 거르지 않는다.
  'devices', json_build_object(
    'team_excluded', (SELECT count(*) FROM team),
    'signup', (SELECT json_agg(json_build_object(
        'device', device, 'users', users, 'users_real', users_real)
        ORDER BY users_real DESC, users DESC) FROM (
        SELECT device, count(*) AS users,
               count(*) FILTER (WHERE NOT is_team) AS users_real
        FROM signup_device GROUP BY device) x),
    'signup_browser', (SELECT json_agg(json_build_object(
        'browser', browser, 'users_real', users_real)
        ORDER BY users_real DESC) FROM (
        SELECT browser, count(*) FILTER (WHERE NOT is_team) AS users_real
        FROM signup_device GROUP BY browser) x),
    'session', (SELECT json_agg(json_build_object(
        'device', device, 'h24', h24, 'd7', d7, 'all', total, 'all_real', total_real)
        ORDER BY total_real DESC, total DESC) FROM (
        SELECT device,
               count(*) FILTER (WHERE created_at > (SELECT h24 FROM w)) AS h24,
               count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)) AS d7,
               count(*) AS total,
               count(*) FILTER (WHERE NOT is_team) AS total_real
        FROM session_device GROUP BY device) x),
    'session_browser', (SELECT json_agg(json_build_object(
        'browser', browser, 'sessions_real', sessions_real)
        ORDER BY sessions_real DESC) FROM (
        SELECT browser, count(*) FILTER (WHERE NOT is_team) AS sessions_real
        FROM session_device GROUP BY browser) x),
    -- 근사가 얼마나 위태로운지 같이 낸다. gap 이 크거나 다기기 사용자면 틀릴 수 있다.
    'quality', (SELECT json_build_object(
        'sessions', count(*),
        'avg_gap_sec', round(avg(gap_sec)::numeric, 0),
        'worst_gap_sec', round(max(gap_sec)::numeric, 0),
        'over_30m', count(*) FILTER (WHERE gap_sec > 1800),
        'multi_device', count(*) FILTER (WHERE multi_device),
        'no_record', count(*) FILTER (WHERE gap_sec IS NULL))
        FROM session_device WHERE NOT is_team),
    'mobile_share_signup', (
      SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(
        100.0 * count(*) FILTER (WHERE device IN
          ('아이폰', '아이패드', '안드로이드 폰', '안드로이드 태블릿', '안드로이드 앱', 'iOS 앱')
        ) / count(*)) END
      FROM signup_device WHERE NOT is_team AND device <> '기록 없음'),
    'mobile_share_session', (
      SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(
        100.0 * count(*) FILTER (WHERE device IN
          ('아이폰', '아이패드', '안드로이드 폰', '안드로이드 태블릿', '안드로이드 앱', 'iOS 앱')
        ) / count(*)) END
      FROM session_device WHERE NOT is_team AND device <> '기록 없음'),
    -- 로그인 수는 체인 머리만 센다. 행을 그대로 세면 30분마다 도는 자동 회전이
    -- 섞여 1.6배로 부푼다(실측 317행 = 로그인 200 + 회전 117).
    'logins', (SELECT json_agg(json_build_object(
        'device', device, 'logins', logins, 'tokens', tokens)
        ORDER BY logins DESC) FROM (
        SELECT device, count(*) FILTER (WHERE is_login) AS logins, count(*) AS tokens
        FROM classified GROUP BY device) x)
  ),
  -- 가입 기기·유입 경로별로 실제 업로드까지 갔는지. 기기 표만으로는
  -- "많이 가입한 기기"와 "실제로 쓰는 기기"가 구분되지 않는다.
  'device_funnel', json_build_object(
    'by_device', (SELECT json_agg(json_build_object(
        'device', device, 'signups', signups, 'uploaded', uploaded, 'sessions', sessions_n)
        ORDER BY signups DESC) FROM (
        SELECT s.device, count(*) AS signups,
               count(*) FILTER (WHERE ui.n > 0) AS uploaded,
               count(*) FILTER (WHERE ps.n > 0) AS sessions_n
        FROM signup_device s
        LEFT JOIN LATERAL (SELECT count(*) n FROM upload_intents x
                           WHERE x.user_id = s.user_id AND x.status::text = 'finalized') ui ON TRUE
        LEFT JOIN LATERAL (SELECT count(*) n FROM ps_all x WHERE x.user_id = s.user_id) ps ON TRUE
        WHERE NOT s.is_team GROUP BY s.device) f),
    'by_browser', (SELECT json_agg(json_build_object(
        'browser', browser, 'signups', signups, 'uploaded', uploaded, 'sessions', sessions_n)
        ORDER BY signups DESC) FROM (
        SELECT s.browser, count(*) AS signups,
               count(*) FILTER (WHERE ui.n > 0) AS uploaded,
               count(*) FILTER (WHERE ps.n > 0) AS sessions_n
        FROM signup_device s
        LEFT JOIN LATERAL (SELECT count(*) n FROM upload_intents x
                           WHERE x.user_id = s.user_id AND x.status::text = 'finalized') ui ON TRUE
        LEFT JOIN LATERAL (SELECT count(*) n FROM ps_all x WHERE x.user_id = s.user_id) ps ON TRUE
        WHERE NOT s.is_team GROUP BY s.browser) f)
  ),
  -- 세션마다 '누가' 를 붙인다. ⚠️ 이메일·user_id 원본은 넣지 않는다 —
  -- 스냅샷은 15분마다 커밋되어 git 이력에 영구히 남는다. 대신 user_id 를
  -- 짧게 해시한 **가명**을 쓴다: 같은 사람인지, 몇 번째 세션인지는 알 수 있고
  -- 그 자체로는 누구인지 알 수 없다. 실명이 필요하면 DB 에서 조회한다.
  'session_actors', (SELECT json_agg(json_build_object(
      'coach_session_id', id, 'actor', actor, 'nth', nth, 'total', total,
      'device', device, 'signup_hour', signup_hour) ORDER BY created_at DESC) FROM (
      SELECT c.id, c.created_at,
             -- pgcrypto 가 없어 코어 내장 md5 를 쓴다. UUID 를 가리는 용도라 충분하다.
             '배우 ' || left(md5(u.id::text), 8) AS actor,
             row_number() OVER (PARTITION BY u.id ORDER BY c.created_at) AS nth,
             count(*) OVER (PARTITION BY u.id) AS total,
             COALESCE((
               SELECT cl.device FROM classified cl
               WHERE cl.user_id = u.id AND cl.issued_at <= c.created_at
               ORDER BY cl.issued_at DESC LIMIT 1
             ), '기기 미상') AS device,
             date_trunc('hour', u.created_at) AS signup_hour
      FROM chat c JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at DESC LIMIT 200) sa),
  'sessions', (SELECT json_agg(json_build_object(
      'practice_session_id', practice_session_id, 'created_at', created_at,
      'actor', actor, 'nth', nth, 'total', total, 'is_team', is_team,
      'platform', platform, 'device', device, 'signup_at', signup_at,
      'status', status, 'blockage_kind', blockage_kind, 'continued', continued,
      'has_summary', has_summary, 'coach_session_id', coach_session_id,
      'coach_status', coach_status, 'close_reason', close_reason,
      'turns_actor', turns_actor, 'turns_ai', turns_ai
    ) ORDER BY created_at DESC) FROM (
      -- 시각은 분 단위로 뭉갠다 — 아래 last_*_hour 와 같은 이유(개인 행동 흔적이
      -- git 이력에 영구히 남는다). 화면이 분까지만 보여주므로 분이면 충분하다.
      SELECT ps.id AS practice_session_id,
             date_trunc('minute', ps.created_at) AS created_at,
             '배우 ' || left(md5(ps.user_id::text), 8) AS actor,
             row_number() OVER (PARTITION BY ps.user_id ORDER BY ps.created_at) AS nth,
             count(*) OVER (PARTITION BY ps.user_id) AS total,
             sd.is_team, sp.platform, sd.device,
             date_trunc('hour', u.created_at) AS signup_at,
             ps.status, ps.blockage_kind,
             ps.continued,
             EXISTS (SELECT 1 FROM analysis_all s WHERE s.session_id = ps.id) AS has_summary,
             cs.id AS coach_session_id, cs.status AS coach_status,
             cs.close_reason AS close_reason,
             COALESCE(ct.turns_actor, 0) AS turns_actor,
             COALESCE(ct.turns_ai, 0) AS turns_ai
      FROM ps_all ps
      JOIN users u ON u.id = ps.user_id
      LEFT JOIN signup_platform sp ON sp.user_id = ps.user_id
      LEFT JOIN session_device sd ON sd.id = ps.id
      -- 연습 세션마다 가장 최근 코치 세션 하나만 가져온다.
      LEFT JOIN LATERAL (
        SELECT c.id, c.status, c.close_reason
        FROM conv_all c WHERE c.practice_id = ps.id
        ORDER BY c.created_at DESC LIMIT 1
      ) cs ON TRUE
      -- 코치 세션이 없으면 필드는 NULL, 턴 수는 0으로 둔다.
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE ct.role = 'actor') AS turns_actor,
               count(*) FILTER (WHERE ct.role = 'ai') AS turns_ai
        FROM turn_all ct WHERE ct.session_id = cs.id
      ) ct ON TRUE
      ORDER BY ps.created_at DESC LIMIT 1000) sessions),
  -- ── 기능별 사용 (SOMA-570) ─────────────────────────────────────────
  -- 전부 팀 제외(team CTE). ⚠️ 자유 글은 싣지 않는다 — 설문 본문·연락처·노트 평가 코멘트·대본·댓글은
  -- 있는지만 센다. 이 JSON 은 수집기를 거쳐 git(ops-data)에 영구히 남는다.
  'features', json_build_object(
    'reading', json_build_object(
      'scripts', (SELECT json_build_object(
          'total', count(*),
          'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)),
          'users', count(DISTINCT user_id),
          'sample', count(*) FILTER (WHERE source = 'sample'),
          'file', count(*) FILTER (WHERE source = 'file'),
          'paste', count(*) FILTER (WHERE source = 'paste'),
          'typed', count(*) FILTER (WHERE source = 'typed'))
        FROM scripts WHERE user_id NOT IN (SELECT id FROM team)),
      'sessions', (SELECT json_build_object(
          'total', count(*),
          'd7', count(*) FILTER (WHERE started_at > (SELECT d7 FROM w)),
          'users', count(DISTINCT user_id),
          'users_d7', count(DISTINCT user_id) FILTER (WHERE started_at > (SELECT d7 FROM w)),
          'completed', count(*) FILTER (WHERE status = 'completed'),
          'stopped', count(*) FILTER (WHERE status = 'stopped'),
          'in_progress', count(*) FILTER (WHERE status = 'in_progress'),
          'read', count(*) FILTER (WHERE mode = 'read'),
          'quiz', count(*) FILTER (WHERE mode = 'quiz'),
          'recorded', count(*) FILTER (WHERE record),
          'avg_minutes', round((avg(elapsed_seconds) FILTER (WHERE status <> 'in_progress')) / 60.0, 1))
        FROM reading_sessions WHERE user_id NOT IN (SELECT id FROM team)),
      'recordings', (SELECT json_build_object(
          'total', count(*),
          'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)),
          'users', count(DISTINCT user_id),
          'matched', count(*) FILTER (WHERE matched),
          'unmatched', count(*) FILTER (WHERE matched = false),
          'minutes', round(COALESCE(sum(duration_ms), 0) / 60000.0, 1))
        FROM reading_recordings WHERE user_id NOT IN (SELECT id FROM team)),
      'memorization', (SELECT json_build_object(
          'memorized', count(*) FILTER (WHERE status = 'memorized'),
          'not_yet', count(*) FILTER (WHERE status = 'not_yet'),
          'users', count(DISTINCT user_id))
        FROM line_memorization WHERE user_id NOT IN (SELECT id FROM team)),
      'daily', (SELECT json_agg(json_build_object(
          'date', to_char(d.date, 'YYYY-MM-DD'),
          'sessions', COALESCE(rs.n, 0), 'users', COALESCE(rs.u, 0), 'completed', COALESCE(rs.done, 0),
          'scripts', COALESCE(sc.n, 0), 'recordings', COALESCE(rr.n, 0)) ORDER BY d.date)
        FROM calendar_days d
        LEFT JOIN (SELECT (started_at AT TIME ZONE 'Asia/Seoul')::date AS date, count(*) AS n,
                          count(DISTINCT user_id) AS u, count(*) FILTER (WHERE status = 'completed') AS done
                   FROM reading_sessions WHERE user_id NOT IN (SELECT id FROM team) GROUP BY 1) rs ON rs.date = d.date
        LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS date, count(*) AS n
                   FROM scripts WHERE user_id NOT IN (SELECT id FROM team) GROUP BY 1) sc ON sc.date = d.date
        LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS date, count(*) AS n
                   FROM reading_recordings WHERE user_id NOT IN (SELECT id FROM team) GROUP BY 1) rr ON rr.date = d.date)
    ),
    'challenges', json_build_object(
      'challenges', (SELECT json_build_object(
          'total', count(*),
          'team', count(*) FILTER (WHERE origin = 'team'),
          'member', count(*) FILTER (WHERE origin = 'member'),
          'active', count(*) FILTER (WHERE starts_at <= now() AND ends_at > now()),
          'd7', count(*) FILTER (WHERE starts_at > (SELECT d7 FROM w)))
        FROM challenges
        WHERE deleted_at IS NULL AND (host_user_id IS NULL OR host_user_id NOT IN (SELECT id FROM team))),
      'entries', (SELECT json_build_object(
          'total', count(*),
          'public', count(*) FILTER (WHERE visibility = 'public'),
          'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)),
          'users', count(DISTINCT user_id),
          'users_d7', count(DISTINCT user_id) FILTER (WHERE created_at > (SELECT d7 FROM w)),
          'hidden_by_report', count(*) FILTER (WHERE status = 'hidden_by_report'),
          'views', COALESCE(sum(view_count), 0))
        FROM challenge_entries WHERE deleted_at IS NULL AND user_id NOT IN (SELECT id FROM team)),
      'likes', (SELECT json_build_object('total', count(*), 'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)),
                                         'users', count(DISTINCT user_id))
        FROM entry_likes WHERE user_id NOT IN (SELECT id FROM team)),
      'comments', (SELECT json_build_object('total', count(*), 'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)),
                                            'users', count(DISTINCT user_id))
        FROM entry_comments WHERE deleted_at IS NULL AND user_id NOT IN (SELECT id FROM team)),
      'saves', (SELECT json_build_object('total', count(*), 'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)))
        FROM entry_saves WHERE user_id NOT IN (SELECT id FROM team)),
      'views', (SELECT json_build_object('total', count(*), 'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)),
                                         'users_d7', count(DISTINCT user_id) FILTER (WHERE created_at > (SELECT d7 FROM w)))
        FROM entry_view_events WHERE user_id NOT IN (SELECT id FROM team)),
      'reports', (SELECT json_build_object('total', count(*), 'received', count(*) FILTER (WHERE status = 'received'),
                                           'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)))
        FROM entry_reports WHERE reporter_id NOT IN (SELECT id FROM team)),
      'ai_reports', (SELECT json_build_object('ready', count(*) FILTER (WHERE status = 'ready'),
                                              'failed', count(*) FILTER (WHERE status = 'failed'),
                                              'pending', count(*) FILTER (WHERE status = 'pending'))
        FROM entry_ai_reports WHERE user_id NOT IN (SELECT id FROM team)),
      'daily', (SELECT json_agg(json_build_object(
          'date', to_char(d.date, 'YYYY-MM-DD'),
          'entries', COALESCE(e.n, 0), 'likes', COALESCE(l.n, 0), 'comments', COALESCE(c.n, 0), 'views', COALESCE(v.n, 0)) ORDER BY d.date)
        FROM calendar_days d
        LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS date, count(*) AS n FROM challenge_entries
                   WHERE deleted_at IS NULL AND user_id NOT IN (SELECT id FROM team) GROUP BY 1) e ON e.date = d.date
        LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS date, count(*) AS n FROM entry_likes
                   WHERE user_id NOT IN (SELECT id FROM team) GROUP BY 1) l ON l.date = d.date
        LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS date, count(*) AS n FROM entry_comments
                   WHERE deleted_at IS NULL AND user_id NOT IN (SELECT id FROM team) GROUP BY 1) c ON c.date = d.date
        LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS date, count(*) AS n FROM entry_view_events
                   WHERE user_id NOT IN (SELECT id FROM team) GROUP BY 1) v ON v.date = d.date)
    ),
    'feedback', json_build_object(
      'notes', (SELECT json_build_object(
          'total', count(*),
          'd7', count(*) FILTER (WHERE n.created_at > (SELECT d7 FROM w)),
          'fallback', count(*) FILTER (WHERE n.fallback),
          'v2', count(*) FILTER (WHERE n.format = 'v2'),
          'action', count(*) FILTER (WHERE n.kind = 'action'),
          'observation', count(*) FILTER (WHERE n.kind = 'observation'),
          'record_only', count(*) FILTER (WHERE n.kind = 'record_only'),
          'legacy', count(*) FILTER (WHERE n.format = 'legacy'))
        FROM coach_notes n
        JOIN coach_conversations c ON c.id = n.conversation_id
        JOIN practices p ON p.id = c.practice_id
        WHERE p.user_id NOT IN (SELECT id FROM team)),
      'ratings', (SELECT json_build_object(
          'helpful', count(*) FILTER (WHERE rating = 'helpful'),
          'not_helpful', count(*) FILTER (WHERE rating = 'not_helpful'),
          'with_comment', count(*) FILTER (WHERE comment IS NOT NULL),
          'd7_helpful', count(*) FILTER (WHERE rating = 'helpful' AND created_at > (SELECT d7 FROM w)),
          'd7_not_helpful', count(*) FILTER (WHERE rating = 'not_helpful' AND created_at > (SELECT d7 FROM w)),
          'users', count(DISTINCT user_id))
        FROM note_ratings WHERE user_id NOT IN (SELECT id FROM team)),
      'exit_survey', (SELECT json_build_object(
          'total', count(*),
          'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)),
          'answered', count(*) FILTER (WHERE body IS NOT NULL),
          'dismissed', count(*) FILTER (WHERE body IS NULL),
          'with_contact', count(*) FILTER (WHERE contact_email IS NOT NULL OR contact_phone IS NOT NULL),
          'coach', count(*) FILTER (WHERE screen = 'coach'),
          'report', count(*) FILTER (WHERE screen = 'report'),
          'x', count(*) FILTER (WHERE trigger = 'x'),
          'leave', count(*) FILTER (WHERE trigger = 'leave'),
          'back', count(*) FILTER (WHERE trigger = 'back'))
        FROM practice_feedback WHERE user_id NOT IN (SELECT id FROM team)),
      'daily', (SELECT json_agg(json_build_object(
          'date', to_char(d.date, 'YYYY-MM-DD'),
          'notes', COALESCE(nt.n, 0), 'helpful', COALESCE(r.h, 0), 'not_helpful', COALESCE(r.nh, 0),
          'surveys', COALESCE(f.n, 0), 'answered', COALESCE(f.a, 0)) ORDER BY d.date)
        FROM calendar_days d
        LEFT JOIN (SELECT (n.created_at AT TIME ZONE 'Asia/Seoul')::date AS date, count(*) AS n
                   FROM coach_notes n JOIN coach_conversations c ON c.id = n.conversation_id
                   JOIN practices p ON p.id = c.practice_id
                   WHERE p.user_id NOT IN (SELECT id FROM team) GROUP BY 1) nt ON nt.date = d.date
        LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS date,
                          count(*) FILTER (WHERE rating = 'helpful') AS h,
                          count(*) FILTER (WHERE rating = 'not_helpful') AS nh
                   FROM note_ratings WHERE user_id NOT IN (SELECT id FROM team) GROUP BY 1) r ON r.date = d.date
        LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS date, count(*) AS n,
                          count(*) FILTER (WHERE body IS NOT NULL) AS a
                   FROM practice_feedback WHERE user_id NOT IN (SELECT id FROM team) GROUP BY 1) f ON f.date = d.date)
    ),
    'community', json_build_object(
      'posts', (SELECT json_build_object('total', count(*), 'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)),
                                         'users', count(DISTINCT author_id))
        FROM community_posts WHERE status::text <> 'deleted' AND author_id NOT IN (SELECT id FROM team)),
      'comments', (SELECT json_build_object('total', count(*), 'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)))
        FROM community_comments WHERE status::text <> 'deleted' AND author_id NOT IN (SELECT id FROM team)),
      'likes', (SELECT json_build_object('total', count(*), 'd7', count(*) FILTER (WHERE created_at > (SELECT d7 FROM w)))
        FROM community_post_likes WHERE user_id NOT IN (SELECT id FROM team)),
      'reports', (SELECT json_build_object('total', count(*), 'pending', count(*) FILTER (WHERE status::text = 'pending'))
        FROM community_reports WHERE reporter_id NOT IN (SELECT id FROM team))
    ),
    'accounts', json_build_object(
      'withdrawn', (SELECT count(*) FROM users WHERE status::text = 'deactivated' AND id NOT IN (SELECT id FROM team)),
      'withdrawn_d7', (SELECT count(*) FROM users
                       WHERE status::text = 'deactivated' AND deactivated_at > (SELECT d7 FROM w) AND id NOT IN (SELECT id FROM team)),
      'guests', (SELECT count(DISTINCT user_id) FROM user_identities
                 WHERE provider::text = 'guest' AND user_id NOT IN (SELECT id FROM team)),
      'guest_transfers', (SELECT count(*) FROM guest_transfer_codes WHERE used_at IS NOT NULL AND user_id NOT IN (SELECT id FROM team)),
      'portfolios', (SELECT count(*) FROM portfolios WHERE user_id NOT IN (SELECT id FROM team)),
      'portfolios_shared', (SELECT count(*) FROM portfolios WHERE share_enabled AND user_id NOT IN (SELECT id FROM team))
    )
  ),
  'db_size', (SELECT pg_size_pretty(pg_database_size(current_database()))),
  'active_7d', (
    SELECT count(DISTINCT user_id) FROM ps_all
    WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date > (SELECT d - 7 FROM b)
  ),
  'signups_7d', (
    SELECT count(*) FROM users
    WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date > (SELECT d - 7 FROM b)
  ),
  -- ⚠️ 위 h24/d7 은 '최근 24시간'(구르는 창)이라 "어제 몇 명"에 답하지 못한다.
  -- 아래 둘만 **달력상 어제**(한국 시각 0시~24시)다. 요약 화면이 "어제"라고
  -- 적는 자리에는 이 둘을 쓴다 — h24 를 어제라고 부르면 하루가 겹쳐서 틀린다.
  'signups_yesterday', (
    SELECT count(*) FROM users
    WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = (SELECT d - 1 FROM b)
  ),
  'signups_yesterday_real', (
    SELECT count(*) FROM users
    WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = (SELECT d - 1 FROM b)
      AND id NOT IN (SELECT id FROM team)
  ),
  'active_yesterday', (
    SELECT count(DISTINCT user_id) FROM ps_all
    WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = (SELECT d - 1 FROM b)
  ),
  'active_yesterday_real', (
    SELECT count(DISTINCT user_id) FROM ps_all
    WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = (SELECT d - 1 FROM b)
      AND user_id NOT IN (SELECT id FROM team)
  ),
  -- ⚠️ 시각은 **시간 단위로 뭉개서** 내보낸다. max(created_at) 을 그대로 쓰면
  -- 특정 사용자가 가입·연습한 순간이 마이크로초까지 남고, 15분마다 커밋되니
  -- git 이력에 개인 행동 흔적이 영구히 쌓인다. 여기서 필요한 건 "숫자가 언제까지
  -- 것인가"뿐이라 시간 단위면 충분하다.
  'last_signup_hour', (SELECT date_trunc('hour', max(created_at)) FROM users),
  'last_session_hour', (SELECT date_trunc('hour', max(created_at)) FROM ps_all)
);
