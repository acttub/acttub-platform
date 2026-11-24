# SOMA-1112 SQL 모양별 HQL 실험 결과

`JpqlShapeProbeIT`가 만든다. Hibernate 7.4.15.Final, PostgreSQL 18(`postgres:18-alpine`), Flyway 로 세운 스키마.
시도마다 Hibernate 가 실제로 보낸 SQL(된다) 또는 오류 문구(안 된다)를 그대로 옮긴다. `결과 같음` 은 같은 데이터에서 원본 네이티브 SQL 과 HQL 의 결과 행을 견준 것이다.

| 실험 | 모양 | 원본 | 결과 |
|---|---|---|---|
| P01 | 행 잠금 FOR UPDATE | `PostgresReadingOwnership#reassign#1` | 스칼라 조회 + PESSIMISTIC_WRITE: 된다<br>엔티티 find + PESSIMISTIC_WRITE: 된다<br>같은 조회, 방언의 getForUpdateString 을 ' for update' 로 바꾼 경우: 된다 |
| P02 | 행 잠금 FOR SHARE | `PostgresEntryRepository#attachMosaic#3` | 스칼라 조회 + PESSIMISTIC_READ: 된다<br>엔티티 find + PESSIMISTIC_READ: 된다 |
| P03 | 조인한 쿼리에서 한 표만 잠금 FOR UPDATE OF | `PostgresActorMemoryStore#appendAvoid#1` | 별칭 u 에만 PESSIMISTIC_WRITE: 된다<br>쿼리 전체에 PESSIMISTIC_WRITE: 된다<br>select 절에 u.id 를 더하고 PESSIMISTIC_WRITE: 된다<br>select 절에 u.id 를 더하고 별칭 u 에만 PESSIMISTIC_WRITE: 된다<br>엔티티 u 를 고르고 left join, PESSIMISTIC_WRITE: 된다<br>원래 조회 + follow-on 잠금 강제(Locking.FollowOn.FORCE): 된다<br>left join 을 inner join 으로 바꾸고 u.id 를 고름, PESSIMISTIC_WRITE: 된다 |
| P04 | SKIP LOCKED + ORDER BY + LIMIT | `PostgresVideoRepository#sweepExpiredIntents#1` | 엔티티 조회 + PESSIMISTIC_WRITE + lock.timeout=-2(SKIP LOCKED): 된다<br>스칼라 조회 + LIMIT 매개변수 + SKIP LOCKED: 된다 |
| P05 | 점유: 읽는 CTE(SKIP LOCKED) + UPDATE … RETURNING | `PostgresAiJobLedger#claimNext#1` | HQL CTE 뒤에 UPDATE: 안 된다<br>HQL UPDATE … RETURNING: 안 된다<br>다시 쓰기: 엔티티를 SKIP LOCKED 로 잡고 고쳐서 flush(문장 둘): 된다 |
| P06 | INSERT … ON CONFLICT DO NOTHING | `PostgresPortfolioRepository#lockOrCreate#2` | HQL insert … on conflict do nothing 를 두 번: 된다 |
| P07 | INSERT … ON CONFLICT DO UPDATE | `PostgresAdFrequency#update#1` | HQL on conflict do update(매개변수): 된다<br>HQL on conflict do update(excluded): 된다 |
| P08 | ON CONFLICT ON CONSTRAINT … DO UPDATE … RETURNING | `AnonymousAliasAllocator#ensureAlias#3` | HQL on conflict on constraint, 이어서 ordinal 을 다시 읽음(문장 둘): 된다 |
| P09 | 데이터를 바꾸는 CTE: DELETE … RETURNING | `PostgresScriptRepository#deleteLine#6` | HQL CTE 안의 DELETE: 안 된다<br>HQL DELETE … RETURNING: 안 된다<br>다시 쓰기: 키를 읽고(잠금) 지움(문장 둘): 된다 |
| P10 | INSERT … SELECT … WHERE NOT EXISTS … ON CONFLICT DO UPDATE … RETURNING id(DB 생성 ID) | `PostgresPushTokenRepository#register#2` | HQL insert … select(FROM 없음, id 를 DB 기본값에 맡김): 안 된다<br>다시 쓰기: id 를 앱이 넘기고, 이어서 token 으로 id 를 읽음(문장 둘): 안 된다<br>insert … select + on conflict on constraint(제약 이름): 안 된다<br>다시 쓰기: 토글을 따로 읽고 insert … values … on conflict(token), 이어서 id 를 읽음(문장 셋): 된다 |
| P11 | 읽기만 하는 CTE + FILTER + = ANY(string_to_array) | `PostgresBillingAdminReader#signedUpBefore#1` | HQL md5() 를 그대로 씀: 안 된다<br>HQL with … select, md5 를 문자열로 cast, 목록은 Java 에서 나눈 List 로: 된다 |
| P12 | WITH RECURSIVE | `PostgresLegacyPracticeReader#find#1(앞부분)` | HQL 재귀 CTE(자기 참조): 된다 |
| P13 | JSON 읽기 ->·->> | `PostgresCoachFlows#assign#2` | HQL json_value(앱 설정 그대로): 안 된다<br>HQL json_value [json_functions_enabled=true]: 된다<br>HQL sql() 조각으로 ->> 를 그대로: 된다 |
| P14 | JSON 쓰기: CAST(:x AS jsonb), 배열 원소 거르기, 키 지우기(jsonb - key) | `PostgresConversationRepository#saveLineNotes#1 · PostgresScriptRepository#deleteLine#5` | HQL update 에 JsonNode 매개변수: 된다<br>HQL json_remove 로 키 지우기: 된다<br>HQL json_query 로 배열 원소 거르기(앱 설정 그대로): 안 된다<br>HQL json_query 로 배열 원소 거르기 [json_functions_enabled=true]: 된다 |
| P15 | LEFT JOIN LATERAL + FROM 절 서브쿼리 | `PostgresCloudVoiceRepository#consent#2` | HQL join lateral: 된다 |
| P16 | 집계 FILTER + GROUP BY + CAST(date AS text) | `PostgresAdRepository#dailyEvents#1` | HQL count(*) filter: 된다 |
| P17 | DISTINCT ON | `PostgresConsentRepository#currentConsentsOf#1` | HQL distinct on: 안 된다<br>다시 쓰기: row_number() over(partition by) = 1: 된다 |
| P18 | 창 함수 rank() OVER + UPDATE … FROM (서브쿼리) | `ChallengeSettlement#confirm#2` | HQL update set = (FROM 절 서브쿼리 안의 창 함수): 된다 |
| P19 | 배열: = ANY(CAST(:ids AS uuid[])) · unnest · array_to_string | `PostgresCommunityRepository#withImages#1 · PostgresReadingVoiceMaterials#material#2 · PostgresSessionRepository#start#3` | IN 목록 매개변수(List): 된다<br>array_contains(배열 매개변수 하나): 된다<br>HQL join unnest(집합 반환 함수): 안 된다<br>HQL join lateral unnest(집합 반환 함수): 된다<br>엔티티로 읽고 배열을 Java 에서 펼침: 된다<br>HQL array_to_string: 된다 |
| P20 | UPDATE … FROM 다른 표 | `PostgresScriptImportRepository#linkUpload#1` | HQL update … from: 안 된다<br>다시 쓰기: where exists(상관 서브쿼리): 된다 |
| P21 | DELETE … USING 다른 표 | `PostgresScriptRepository#delete#4` | HQL delete … using: 안 된다<br>다시 쓰기: where … in (서브쿼리): 된다 |
| P22 | INSERT … SELECT … ON CONFLICT DO NOTHING | `PostgresAuthRepository#recordActiveDay#1` | HQL insert … select … on conflict do nothing 를 두 번: 된다<br>HQL insert … select … order by … limit :batch … on conflict do nothing: 된다 |
| P23 | 정규식 ~ · substring FROM · 스칼라 서브쿼리 LIMIT 1 · FROM 없는 SELECT | `PostgresCloudVoiceRepository#consent#1` | HQL regexp_like, FROM 없는 select exists: 된다<br>regexp_replace(등록되지 않은 함수를 이름으로 부름): 된다 |
| P24 | string_agg(… ORDER BY …) | `PostgresProfileRepository#find#1(부분)` | HQL listagg … within group: 된다 |
| P25 | 조건부 UPDATE 의 영향 행 수 + GREATEST + 열 증감 | `PostgresRetranscribeRepository#release#1` | HQL update 를 두 번(두 번째는 조건이 안 맞음): 된다 |
| P26 | 시간 계산: to_char · AT TIME ZONE · ::date · now() - interval | `PostgresPracticeReminderRepository#recentTemplates#1 · #countedPracticeDays#1 · PostgresCoachProMemory#recent#1` | HQL format(… as 'yyyy-MM-dd'): 된다<br>AT TIME ZONE 대신 timezone() 함수를 이름으로 부름: 된다<br>HQL instant - 60 day: 된다 |
| P27 | 행 값 비교 (a, b) < (x, y) | `PostgresCloudVoiceRepository#firstReadingSession#1` | HQL 튜플 비교: 된다 |
| P28 | INSERT … SELECT 안의 gen_random_uuid() | `PostgresPracticeDataMigration#applyMessages#1` | HQL insert … select gen_random_uuid(): 안 된다<br>HQL insert … select cast(gen_random_uuid() as UUID): 안 된다<br>HQL insert … select cast(gen_random_uuid() as java.util.UUID): 된다 |
| P29 | UNION | `PostgresProfileRepository#videoKeys#1` | HQL union: 된다 |
| P30 | 권고 잠금 pg_advisory_xact_lock | `PostgresChallengeRepository#createTeam#1` | HQL FROM 절에 함수: 안 된다<br>HQL select 절에서 함수를 이름으로 부름: 된다<br>HQL function('…') 문법: 된다 |
| P31 | SET LOCAL · SET CONSTRAINTS | `PostgresSessionRepository#saveProgress#2 · PostgresScriptRepository#update#3` | HQL set local: 안 된다<br>HQL set_config(…, true) 함수 호출: 된다<br>HQL set constraints: 안 된다 |
| P32 | SELECT 절 서브쿼리·EXISTS, IN 목록 | `EntryCards#cards#1(부분)` | HQL 스칼라 서브쿼리: 된다 |
| P33 | FROM 없는 SELECT 1(상태 확인) | `DatabaseHealthIndicator#checkDatabase#1` | HQL select 1: 된다<br>HQL order by … nulls last: 된다 |
| P34 | 상관 서브쿼리로 값을 다시 세는 UPDATE … RETURNING | `PostgresCommunityRepository#resyncLikeCount#1` | HQL update set = (상관 서브쿼리), 이어서 값을 읽음(문장 둘): 된다 |
| P35 | HQL 안에 SQL 조각 넣기 sql('…') | `(여러 곳: ->>·~·AT TIME ZONE 처럼 HQL 에 문법이 없는 연산자)` | HQL sql() 로 ->> 연산자: 된다<br>HQL sql() 로 ~ 연산자(조건 자리에 그대로): 안 된다<br>HQL sql() 로 ~ 연산자(Boolean 으로 cast): 된다<br>HQL sql() 로 AT TIME ZONE: 된다 |
| P36 | INSERT … VALUES(조건 없음) | `PostgresAdRepository#recordEvent 류` | 엔티티 persist: 된다 |
| P37 | 잠금 세기: FOR UPDATE 와 Hibernate 의 FOR NO KEY UPDATE(자식 행 INSERT 를 막는가) | `PostgresPushTokenRepository#register#1 처럼 users 행을 잡는 곳` |  |
| P38 | 한 문장 갱신을 '읽고 고치고 저장'으로 바꾸면(잃어버린 갱신) | `PostgresCommunityRepository#deleteComment#2 같은 열 증감` |  |
| P39 | JPQL 로 한꺼번에 고친 뒤 같은 트랜잭션의 엔티티가 든 낡은 값 | `CONTRACT §5-2·§5-4: native bulk 뒤 clear·재조회 규칙` | 엔티티를 읽은 뒤 JPQL UPDATE, 이어서 다른 필드를 고쳐 flush: 된다<br>JPQL UPDATE 뒤 refresh: 된다 |
| P40 | 쿼리 수: 한 쿼리의 서브쿼리 vs 행마다 저장소 메서드 | `EntryCards#cards#1 의 like_count` | HQL 한 쿼리(스칼라 서브쿼리): 된다<br>엔티티 목록 + 행마다 count 메서드(관계 매핑 없이 저장소 메서드로 나눈 경우): 된다 |
| P41 | ILIKE … ESCAPE · CAST(:p AS text) IS NULL(널 매개변수) · = ANY(배열 열) · LATERAL | `PostgresScriptRepository#list#1(부분)` | HQL ilike … escape, :pattern is null(널), array_contains(배열 열, 값): 된다 |
| P42 | (array_agg(… ORDER BY …))[1] · bool_or · count(DISTINCT) | `PostgresNotificationRepository#inbox#1(같은 연산)` | HQL array_agg … within group 의 첫 원소(array_get), any(조건): 안 된다<br>다시 쓰기: 첫 원소를 상관 서브쿼리(order by … limit 1)로: 된다 |
| P43 | 빈 목록: NOT (id = ANY(빈 배열)) · 배열 매개변수 INSERT(CAST(:x AS uuid[])) | `PostgresCommunityRepository#replaceImages#1 · PostgresEntryRepository#byLikes#2` | HQL not in :keep 에 빈 List: 된다<br>HQL not array_contains(:keep, id) 에 빈 배열: 된다<br>HQL insert … values 에 UUID[]·Integer[] 매개변수: 된다 |
| P44 | jsonb_typeof·jsonb_array_length·jsonb_agg(jsonb_build_object(…) ORDER BY …) | `PostgresLegacyPracticeReader#find#1 · PostgresPracticeDataMigration#applyTranscripts#1` | 등록 안 된 jsonb_* 함수를 이름으로 부르고 cast: 된다<br>HQL json_arrayagg(json_object(…) order by …)(앱 설정 그대로): 안 된다<br>HQL json_arrayagg(json_object(…) order by …) [json_functions_enabled=true]: 된다 |
| P45 | JPQL CURRENT_TIMESTAMP 와 now() | `PostgresPortfolioRepository#saveIntro 의 updated_at=now() (표본)` | 세션 TimeZone=UTC 에서 JPQL current_timestamp 를 timestamptz 열에 쓰고 now() 와 견줌: 된다<br>세션 TimeZone=America/New_York 에서 JPQL current_timestamp 를 timestamptz 열에 쓰고 now() 와 견줌: 된다<br>세션 TimeZone=Asia/Seoul 에서 JPQL current_timestamp 를 timestamptz 열에 쓰고 now() 와 견줌: 된다 |

## P01 행 잠금 FOR UPDATE

원본 `PostgresReadingOwnership#reassign#1`

```sql
SELECT id FROM users WHERE id=:from FOR UPDATE
```

### 스칼라 조회 + PESSIMISTIC_WRITE — 된다

```
select u.id from ProbeUser u where u.id = :from
```

Hibernate 가 보낸 SQL:

```sql
select pu1_0.id from users pu1_0 where pu1_0.id=? for no key update of pu1_0;
```

관찰: `[00000000-0000-0000-0000-0000000000a1]`

### 엔티티 find + PESSIMISTIC_WRITE — 된다

```
session.find(ProbeUser.class, id, PESSIMISTIC_WRITE)
```

Hibernate 가 보낸 SQL:

```sql
select pu1_0.id,pu1_0.created_at,pu1_0.deactivated_at,pu1_0.email,pu1_0.retention_purged_at,pu1_0.status from users pu1_0 where pu1_0.id=? for no key update of pu1_0;
```

관찰: `00000000-0000-0000-0000-0000000000a1`

### 같은 조회, 방언의 getForUpdateString 을 ' for update' 로 바꾼 경우 — 된다

```
select u.id from ProbeUser u where u.id = :from
```

Hibernate 가 보낸 SQL:

```sql
select pu1_0.id from users pu1_0 where pu1_0.id=? for update of pu1_0;
```

관찰: `[00000000-0000-0000-0000-0000000000a1]`

- 스칼라 조회 + PESSIMISTIC_WRITE: 보낸 SQL 의 잠금 절 있음

- 엔티티 find + PESSIMISTIC_WRITE: 보낸 SQL 의 잠금 절 있음

- 같은 조회, 방언의 getForUpdateString 을 ' for update' 로 바꾼 경우: 보낸 SQL 의 잠금 절 있음

- Hibernate 7.4 의 PostgreSQLDialect#getForUpdateString 은 ' for no key update' 를 돌려준다(바이트코드 확인). 원본의 FOR UPDATE 와 잠금 세기가 다르다 — P37 이 차이를 두 세션으로 보인다.

## P02 행 잠금 FOR SHARE

원본 `PostgresEntryRepository#attachMosaic#3`

```sql
SELECT object_key,purged_at FROM videos WHERE id=:id FOR SHARE
```

### 스칼라 조회 + PESSIMISTIC_READ — 된다

```
select v.objectKey, v.purgedAt from ProbeVideo v where v.id = :id
```

Hibernate 가 보낸 SQL:

```sql
select pv1_0.object_key,pv1_0.purged_at from videos pv1_0 where pv1_0.id=? for share of pv1_0;
```

관찰: `1`

### 엔티티 find + PESSIMISTIC_READ — 된다

```
session.find(ProbeVideo.class, id, PESSIMISTIC_READ)
```

Hibernate 가 보낸 SQL:

```sql
select pv1_0.id,pv1_0.object_key,pv1_0.poster_key,pv1_0.purged_at,pv1_0.user_id from videos pv1_0 where pv1_0.id=? for share of pv1_0;
```

관찰: `v/1`

- 스칼라 조회 + PESSIMISTIC_READ: 보낸 SQL 의 잠금 절 있음

## P03 조인한 쿼리에서 한 표만 잠금 FOR UPDATE OF

원본 `PostgresActorMemoryStore#appendAvoid#1`

```sql
SELECT m.value,m.written_by,
       EXISTS (SELECT 1 FROM actor_memories a WHERE a.user_id=u.id AND a.field='avoid'
                 AND a.scene_root_id IS NULL AND a.written_by='actor') AS actor_owned
FROM users u
LEFT JOIN actor_memories m ON m.user_id=u.id AND m.field='avoid'
     AND m.scene_root_id IS NOT DISTINCT FROM (SELECT p.root_id FROM practices p WHERE p.id=:practiceId)
WHERE u.id=:userId AND u.status='active'
FOR UPDATE OF u
```

### 별칭 u 에만 PESSIMISTIC_WRITE — 된다

```
select m.value as value, m.writtenBy as writtenBy,
       exists (select 1 from ProbeActorMemory a where a.userId = u.id and a.field = 'avoid'
                 and a.sceneRootId is null and a.writtenBy = 'actor') as actorOwned
from ProbeUser u
left join ProbeActorMemory m on m.userId = u.id and m.field = 'avoid'
     and m.sceneRootId is not distinct from (select p.rootId from ProbePractice p where p.id = :practiceId)
where u.id = :userId and u.status = 'active'
```

Hibernate 가 보낸 SQL:

```sql
select pam1_0.value,pam1_0.written_by,exists(select 1 from actor_memories pam2_0 where pam2_0.user_id=pu1_0.id and pam2_0.field='avoid' and pam2_0.scene_root_id is null and pam2_0.written_by='actor') from users pu1_0 left join actor_memories pam1_0 on pam1_0.user_id=pu1_0.id and pam1_0.field='avoid' and pam1_0.scene_root_id is not distinct from (select pp1_0.root_id from practices pp1_0 where pp1_0.id=?) where pu1_0.id=? and pu1_0.status='active';
```

관찰: `1`

### 쿼리 전체에 PESSIMISTIC_WRITE — 된다

```
select m.value as value, m.writtenBy as writtenBy,
       exists (select 1 from ProbeActorMemory a where a.userId = u.id and a.field = 'avoid'
                 and a.sceneRootId is null and a.writtenBy = 'actor') as actorOwned
from ProbeUser u
left join ProbeActorMemory m on m.userId = u.id and m.field = 'avoid'
     and m.sceneRootId is not distinct from (select p.rootId from ProbePractice p where p.id = :practiceId)
where u.id = :userId and u.status = 'active'
```

Hibernate 가 보낸 SQL:

```sql
select pam1_0.value,pam1_0.written_by,exists(select 1 from actor_memories pam2_0 where pam2_0.user_id=pu1_0.id and pam2_0.field='avoid' and pam2_0.scene_root_id is null and pam2_0.written_by='actor') from users pu1_0 left join actor_memories pam1_0 on pam1_0.user_id=pu1_0.id and pam1_0.field='avoid' and pam1_0.scene_root_id is not distinct from (select pp1_0.root_id from practices pp1_0 where pp1_0.id=?) where pu1_0.id=? and pu1_0.status='active';
```

관찰: `1`

### select 절에 u.id 를 더하고 PESSIMISTIC_WRITE — 된다

```
select u.id as userIdLocked, m.value as value, m.writtenBy as writtenBy,
       exists (select 1 from ProbeActorMemory a where a.userId = u.id and a.field = 'avoid'
                 and a.sceneRootId is null and a.writtenBy = 'actor') as actorOwned
from ProbeUser u
left join ProbeActorMemory m on m.userId = u.id and m.field = 'avoid'
     and m.sceneRootId is not distinct from (select p.rootId from ProbePractice p where p.id = :practiceId)
where u.id = :userId and u.status = 'active'
```

Hibernate 가 보낸 SQL:

```sql
select pu1_0.id,pam1_0.value,pam1_0.written_by,exists(select 1 from actor_memories pam2_0 where pam2_0.user_id=pu1_0.id and pam2_0.field='avoid' and pam2_0.scene_root_id is null and pam2_0.written_by='actor') from users pu1_0 left join actor_memories pam1_0 on pam1_0.user_id=pu1_0.id and pam1_0.field='avoid' and pam1_0.scene_root_id is not distinct from (select pp1_0.root_id from practices pp1_0 where pp1_0.id=?) where pu1_0.id=? and pu1_0.status='active';
```

관찰: `1`

### select 절에 u.id 를 더하고 별칭 u 에만 PESSIMISTIC_WRITE — 된다

```
select u.id as userIdLocked, m.value as value, m.writtenBy as writtenBy,
       exists (select 1 from ProbeActorMemory a where a.userId = u.id and a.field = 'avoid'
                 and a.sceneRootId is null and a.writtenBy = 'actor') as actorOwned
from ProbeUser u
left join ProbeActorMemory m on m.userId = u.id and m.field = 'avoid'
     and m.sceneRootId is not distinct from (select p.rootId from ProbePractice p where p.id = :practiceId)
where u.id = :userId and u.status = 'active'
```

Hibernate 가 보낸 SQL:

```sql
select pu1_0.id,pam1_0.value,pam1_0.written_by,exists(select 1 from actor_memories pam2_0 where pam2_0.user_id=pu1_0.id and pam2_0.field='avoid' and pam2_0.scene_root_id is null and pam2_0.written_by='actor') from users pu1_0 left join actor_memories pam1_0 on pam1_0.user_id=pu1_0.id and pam1_0.field='avoid' and pam1_0.scene_root_id is not distinct from (select pp1_0.root_id from practices pp1_0 where pp1_0.id=?) where pu1_0.id=? and pu1_0.status='active';
```

관찰: `1`

### 엔티티 u 를 고르고 left join, PESSIMISTIC_WRITE — 된다

```
select u from ProbeUser u
left join ProbeActorMemory m on m.userId = u.id and m.field = 'avoid'
where u.id = :userId and u.status = 'active'
```

Hibernate 가 보낸 SQL:

```sql
select pu1_0.id,pu1_0.created_at,pu1_0.deactivated_at,pu1_0.email,pu1_0.retention_purged_at,pu1_0.status from users pu1_0 left join actor_memories pam1_0 on pam1_0.user_id=pu1_0.id and pam1_0.field='avoid' where pu1_0.id=? and pu1_0.status='active';
select tbl.id,tbl.created_at,tbl.deactivated_at,tbl.email,tbl.retention_purged_at,tbl.status from users tbl where tbl.id in (?) for no key update of tbl;
```

관찰: `1`

### 원래 조회 + follow-on 잠금 강제(Locking.FollowOn.FORCE) — 된다

```
select m.value as value, m.writtenBy as writtenBy,
       exists (select 1 from ProbeActorMemory a where a.userId = u.id and a.field = 'avoid'
                 and a.sceneRootId is null and a.writtenBy = 'actor') as actorOwned
from ProbeUser u
left join ProbeActorMemory m on m.userId = u.id and m.field = 'avoid'
     and m.sceneRootId is not distinct from (select p.rootId from ProbePractice p where p.id = :practiceId)
where u.id = :userId and u.status = 'active'
```

Hibernate 가 보낸 SQL:

```sql
select pam1_0.value,pam1_0.written_by,exists(select 1 from actor_memories pam2_0 where pam2_0.user_id=pu1_0.id and pam2_0.field='avoid' and pam2_0.scene_root_id is null and pam2_0.written_by='actor') from users pu1_0 left join actor_memories pam1_0 on pam1_0.user_id=pu1_0.id and pam1_0.field='avoid' and pam1_0.scene_root_id is not distinct from (select pp1_0.root_id from practices pp1_0 where pp1_0.id=?) where pu1_0.id=? and pu1_0.status='active';
```

관찰: `1`

### left join 을 inner join 으로 바꾸고 u.id 를 고름, PESSIMISTIC_WRITE — 된다

```
select u.id as userIdLocked, m.value as value, m.writtenBy as writtenBy,
       exists (select 1 from ProbeActorMemory a where a.userId = u.id and a.field = 'avoid'
                 and a.sceneRootId is null and a.writtenBy = 'actor') as actorOwned
from ProbeUser u
join ProbeActorMemory m on m.userId = u.id and m.field = 'avoid'
     and m.sceneRootId is not distinct from (select p.rootId from ProbePractice p where p.id = :practiceId)
where u.id = :userId and u.status = 'active'
```

Hibernate 가 보낸 SQL:

```sql
select pu1_0.id,pam1_0.value,pam1_0.written_by,exists(select 1 from actor_memories pam2_0 where pam2_0.user_id=pu1_0.id and pam2_0.field='avoid' and pam2_0.scene_root_id is null and pam2_0.written_by='actor') from users pu1_0 join actor_memories pam1_0 on pam1_0.user_id=pu1_0.id and pam1_0.field='avoid' and pam1_0.scene_root_id is not distinct from (select pp1_0.root_id from practices pp1_0 where pp1_0.id=?) where pu1_0.id=? and pu1_0.status='active' for no key update of pu1_0,pam1_0;
```

관찰: `0`

- 별칭 u 에만 PESSIMISTIC_WRITE: 보낸 SQL 의 잠금 절 없음(오류 없이 빠짐)

- 쿼리 전체에 PESSIMISTIC_WRITE: 보낸 SQL 의 잠금 절 없음(오류 없이 빠짐)

- select 절에 u.id 를 더하고 PESSIMISTIC_WRITE: 보낸 SQL 의 잠금 절 없음(오류 없이 빠짐)

- select 절에 u.id 를 더하고 별칭 u 에만 PESSIMISTIC_WRITE: 보낸 SQL 의 잠금 절 없음(오류 없이 빠짐)

- 엔티티 u 를 고르고 left join, PESSIMISTIC_WRITE: 보낸 SQL 의 잠금 절 있음

- 원래 조회 + follow-on 잠금 강제(Locking.FollowOn.FORCE): 보낸 SQL 의 잠금 절 없음(오류 없이 빠짐)

- left join 을 inner join 으로 바꾸고 u.id 를 고름, PESSIMISTIC_WRITE: 보낸 SQL 의 잠금 절 있음

- inner join 이면 잠금 절이 나가지만 'of' 뒤에 조인한 두 표가 다 붙는다(원본은 users 하나만 잡는다). left join 이면 루트를 골라도 잠금 절이 오류 없이 빠진다. 엔티티 u 자체를 고르면 잠긴다.

## P04 SKIP LOCKED + ORDER BY + LIMIT

원본 `PostgresVideoRepository#sweepExpiredIntents#1`

```sql
SELECT id,user_id,object_key FROM upload_intents
WHERE status='pending' AND expires_at<=:now
ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED
```

### 엔티티 조회 + PESSIMISTIC_WRITE + lock.timeout=-2(SKIP LOCKED) — 된다

```
select ui from ProbeUploadIntent ui where ui.status = 'pending' and ui.expiresAt <= :now order by ui.expiresAt limit 200
```

Hibernate 가 보낸 SQL:

```sql
select pui1_0.id,pui1_0.expires_at,pui1_0.object_key,pui1_0.status,pui1_0.user_id from upload_intents pui1_0 where pui1_0.status='pending' and pui1_0.expires_at<=? order by pui1_0.expires_at fetch first 200 rows only for no key update of pui1_0 skip locked;
```

관찰: `2`

### 스칼라 조회 + LIMIT 매개변수 + SKIP LOCKED — 된다

```
select ui.id, ui.userId, ui.objectKey from ProbeUploadIntent ui where ui.status = 'pending' and ui.expiresAt <= :now order by ui.expiresAt limit :limit
```

Hibernate 가 보낸 SQL:

```sql
select pui1_0.id,pui1_0.user_id,pui1_0.object_key from upload_intents pui1_0 where pui1_0.status='pending' and pui1_0.expires_at<=? order by pui1_0.expires_at fetch first ? rows only for no key update of pui1_0 skip locked;
```

관찰: `2`

- 엔티티 조회 + PESSIMISTIC_WRITE + lock.timeout=-2(SKIP LOCKED): 보낸 SQL 의 잠금 절 있음

- 두 세션 확인: 첫 세션이 up/1 를 잡은 동안 둘째 세션은 [up/2] 만 받았다(잡힌 행을 건너뜀).

## P05 점유: 읽는 CTE(SKIP LOCKED) + UPDATE … RETURNING

원본 `PostgresAiJobLedger#claimNext#1`

```sql
WITH picked AS (
    SELECT id FROM ai_jobs
    WHERE kind=:kind AND (status='pending' OR (:reclaim AND status='running' AND lease_expires_at<:now))
      AND attempt_count<:maxAttempts
    ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
)
UPDATE ai_jobs SET status='running', attempt_count=attempt_count+1, lease_token=:leaseToken,
       lease_expires_at=:leaseExpiresAt, updated_at=:now
WHERE id IN (SELECT id FROM picked)
RETURNING id,user_id,target_id,attempt_count,memory_epoch
```

### HQL CTE 뒤에 UPDATE — 안 된다

```
with picked as (
    select j.id as id from ProbeAiJob j
    where j.kind = :kind and (j.status = 'pending' or (:reclaim = true and j.status = 'running' and j.leaseExpiresAt < :now))
      and j.attemptCount < :maxAttempts
    order by j.createdAt, j.id limit 1
)
update ProbeAiJob j set j.status = 'running', j.attemptCount = j.attemptCount + 1
where j.id in (select p.id from picked p)
```

오류: `IllegalArgumentException: org.hibernate.query.SyntaxException: At 7:0 and token 'update', mismatched input 'update', expecting one of the following tokens: '(', FROM, ORDER, SELECT, WHERE [with picked as ( ← SyntaxException: At 7:0 and token 'update', mismatched input 'update', expecting one of the following tokens: '(', FROM, ORDER, SELECT, WHERE [with picked as (`

### HQL UPDATE … RETURNING — 안 된다

```
update ProbeAiJob j set j.status = 'running' where j.id = :id returning j.id, j.attemptCount
```

오류: `IllegalArgumentException: org.hibernate.query.SyntaxException: At 1:62 and token 'returning', mismatched input 'returning', expecting one of the following tokens: <EOF>, '+', '-', '*', '/', '%', '||', AND, BY, DAY, EPOCH, HOUR, MINUTE, MONTH, NANOSECOND, OR, QUARTER, SECOND, WEEK, YEAR [update ProbeAiJob j set j.status = 'running' where j.id = :id returning j.id, j.attemptCount] ← SyntaxException: At 1:62 and token 'returning', mismatched input 'returning', expecting one of the following tokens: <EOF>, '+', '-', '*', '/', '%', '||', AND, BY, DAY, EPOCH, HOUR, MINUTE, MONTH, NANOSECOND, OR, QUARTER, SECOND, WEEK, YEAR [update ProbeAiJob j set j.status = 'running' where j.id = :id returning j.id, j.attemptCount]`

### 다시 쓰기: 엔티티를 SKIP LOCKED 로 잡고 고쳐서 flush(문장 둘) — 된다

```
select j from ProbeAiJob j
where j.kind = :kind and (j.status = 'pending' or (:reclaim = true and j.status = 'running' and j.leaseExpiresAt < :now))
  and j.attemptCount < :maxAttempts
order by j.createdAt, j.id limit 1

-- 이어서 엔티티 필드를 바꾸고 flush
```

Hibernate 가 보낸 SQL:

```sql
select paj1_0.id,paj1_0.attempt_count,paj1_0.created_at,paj1_0.kind,paj1_0.lease_expires_at,paj1_0.lease_token,paj1_0.memory_epoch,paj1_0.status,paj1_0.target_id,paj1_0.updated_at,paj1_0.user_id from ai_jobs paj1_0 where paj1_0.kind=? and (paj1_0.status='pending' or (?=true and paj1_0.status='running' and paj1_0.lease_expires_at<?)) and paj1_0.attempt_count<? order by paj1_0.created_at,paj1_0.id fetch first 1 rows only for no key update of paj1_0 skip locked;
update ai_jobs set attempt_count=?,created_at=?,kind=?,lease_expires_at=?,lease_token=?,memory_epoch=?,status=?,target_id=?,updated_at=?,user_id=? where id=?;
```

관찰: `00000000-0000-0000-0000-000000000041 attempt=1`

## P06 INSERT … ON CONFLICT DO NOTHING

원본 `PostgresPortfolioRepository#lockOrCreate#2`

```sql
INSERT INTO portfolios(user_id) VALUES (:userId) ON CONFLICT (user_id) DO NOTHING
```

### HQL insert … on conflict do nothing 를 두 번 — 된다

```
insert into ProbePortfolio(userId) values (:userId) on conflict(userId) do nothing
```

Hibernate 가 보낸 SQL:

```sql
insert into portfolios as pp1_0(user_id) values (?) on conflict(user_id) do nothing;
insert into portfolios as pp1_0(user_id) values (?) on conflict(user_id) do nothing;
```

관찰: `영향 행 1 다음 0`

## P07 INSERT … ON CONFLICT DO UPDATE

원본 `PostgresAdFrequency#update#1`

```sql
INSERT INTO ad_settings(id,window_minutes,window_cap,first_day_cap,updated_at)
VALUES (1,:minutes,:cap,:firstDay,:now)
ON CONFLICT (id) DO UPDATE SET window_minutes=:minutes,window_cap=:cap,first_day_cap=:firstDay,updated_at=:now
```

### HQL on conflict do update(매개변수) — 된다

```
insert into ProbeAdSettings(id, windowMinutes, windowCap, firstDayCap, updatedAt)
values (1, :minutes, :cap, :firstDay, :now)
on conflict(id) do update set windowMinutes = :minutes, windowCap = :cap, firstDayCap = :firstDay, updatedAt = :now
```

Hibernate 가 보낸 SQL:

```sql
insert into ad_settings as pas1_0(id,window_minutes,window_cap,first_day_cap,updated_at) values (1,?,?,?,?) on conflict(id) do update set window_minutes=?,window_cap=?,first_day_cap=?,updated_at=?;
insert into ad_settings as pas1_0(id,window_minutes,window_cap,first_day_cap,updated_at) values (1,?,?,?,?) on conflict(id) do update set window_minutes=?,window_cap=?,first_day_cap=?,updated_at=?;
select pas1_0.window_minutes from ad_settings pas1_0 where pas1_0.id=1;
```

관찰: `영향 행 1 다음 1, 값=8`

### HQL on conflict do update(excluded) — 된다

```
insert into ProbeAdSettings(id, windowMinutes, windowCap, firstDayCap, updatedAt)
values (1, :minutes, :cap, :firstDay, :now)
on conflict(id) do update set windowMinutes = excluded.windowMinutes, updatedAt = excluded.updatedAt
```

Hibernate 가 보낸 SQL:

```sql
insert into ad_settings as pas1_0(id,window_minutes,window_cap,first_day_cap,updated_at) values (1,?,?,?,?) on conflict(id) do update set window_minutes=excluded.window_minutes,updated_at=excluded.updated_at;
```

관찰: `1`

## P08 ON CONFLICT ON CONSTRAINT … DO UPDATE … RETURNING

원본 `AnonymousAliasAllocator#ensureAlias#3`

```sql
WITH inserted AS (
    INSERT INTO community_anonymous_aliases (id,post_id,user_id,ordinal)
    VALUES (:id,:postId,:userId,:ordinal)
    ON CONFLICT ON CONSTRAINT uq_community_alias_post_user DO UPDATE SET user_id=EXCLUDED.user_id
    RETURNING ordinal
)
SELECT ordinal AS ordinal FROM inserted
```

### HQL on conflict on constraint, 이어서 ordinal 을 다시 읽음(문장 둘) — 된다

```
insert into ProbeAlias(id, postId, userId, ordinal) values (:id, :postId, :userId, :ordinal)
on conflict on constraint uq_community_alias_post_user do update set userId = excluded.userId
```

Hibernate 가 보낸 SQL:

```sql
insert into community_anonymous_aliases as pa1_0(id,post_id,user_id,ordinal) values (?,?,?,?) on conflict on constraint uq_community_alias_post_user do update set user_id=excluded.user_id;
insert into community_anonymous_aliases as pa1_0(id,post_id,user_id,ordinal) values (?,?,?,?) on conflict on constraint uq_community_alias_post_user do update set user_id=excluded.user_id;
select pa1_0.ordinal from community_anonymous_aliases pa1_0 where pa1_0.post_id=? and pa1_0.user_id=?;
```

관찰: `영향 행 1 다음 1, 읽은 ordinal=1`

## P09 데이터를 바꾸는 CTE: DELETE … RETURNING

원본 `PostgresScriptRepository#deleteLine#6`

```sql
WITH removed AS (DELETE FROM reading_recordings WHERE line_id=:lineId RETURNING object_key) SELECT object_key FROM removed
```

### HQL CTE 안의 DELETE — 안 된다

```
with removed as (delete from ProbeReadingRecording r where r.lineId = :lineId returning r.objectKey) select x.objectKey from removed x
```

오류: `IllegalArgumentException: org.hibernate.query.SyntaxException: At 1:17 and token 'delete', extraneous input 'delete' expecting {'(', FROM, ORDER, SELECT, WHERE, WITH} [with removed as (delete from ProbeReadingRecording r where r.lineId = :lineId returning r.objectKey) select x.objectKey from removed x] ← SyntaxException: At 1:17 and token 'delete', extraneous input 'delete' expecting {'(', FROM, ORDER, SELECT, WHERE, WITH} [with removed as (delete from ProbeReadingRecording r where r.lineId = :lineId returning r.objectKey) select x.objectKey from removed x]`

### HQL DELETE … RETURNING — 안 된다

```
delete from ProbeReadingRecording r where r.lineId = :lineId returning r.objectKey
```

오류: `IllegalArgumentException: org.hibernate.query.SyntaxException: At 1:61 and token 'returning', mismatched input 'returning', expecting one of the following tokens: <EOF>, '+', '-', '*', '/', '%', '||', AND, BY, DAY, EPOCH, HOUR, MINUTE, MONTH, NANOSECOND, OR, QUARTER, SECOND, WEEK, YEAR [delete from ProbeReadingRecording r where r.lineId = :lineId returning r.objectKey] ← SyntaxException: At 1:61 and token 'returning', mismatched input 'returning', expecting one of the following tokens: <EOF>, '+', '-', '*', '/', '%', '||', AND, BY, DAY, EPOCH, HOUR, MINUTE, MONTH, NANOSECOND, OR, QUARTER, SECOND, WEEK, YEAR [delete from ProbeReadingRecording r where r.lineId = :lineId returning r.objectKey]`

### 다시 쓰기: 키를 읽고(잠금) 지움(문장 둘) — 된다

```
select r.objectKey from ProbeReadingRecording r where r.lineId = :lineId
delete from ProbeReadingRecording r where r.lineId = :lineId
```

Hibernate 가 보낸 SQL:

```sql
select prr1_0.object_key from reading_recordings prr1_0 where prr1_0.line_id=? for no key update of prr1_0;
delete from reading_recordings prr1_0 where prr1_0.line_id=?;
```

관찰: `키 [rec/a, rec/b], 지운 행 2`

- 두 세션 확인(문장 둘로 나눈 경우): 읽은 키 [rec/a, rec/b] 인데 지운 행은 3 — 사이에 들어온 rec/late 는 지워졌지만 키를 받지 못했다(저장소 객체가 고아로 남는다). 원본 한 문장은 지운 행의 키를 모두 돌려준다.

## P10 INSERT … SELECT … WHERE NOT EXISTS … ON CONFLICT DO UPDATE … RETURNING id(DB 생성 ID)

원본 `PostgresPushTokenRepository#register#2`

```sql
WITH registered AS (
    INSERT INTO push_tokens(user_id,token,platform,locale,app_version)
    SELECT :userId,:token,:platform,:locale,:appVersion
    WHERE NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id=:userId
                        AND NOT notify_analysis_done AND NOT notify_challenge AND NOT notify_evening_reminder)
    ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform,
        locale=EXCLUDED.locale, app_version=EXCLUDED.app_version, updated_at=now()
    RETURNING id
)
SELECT id FROM registered
```

### HQL insert … select(FROM 없음, id 를 DB 기본값에 맡김) — 안 된다

```
insert into ProbePushToken(userId, token, platform, locale, appVersion)
select :userId, :token, :platform, :locale, :appVersion
where not exists (select 1 from ProbeUserProfile p where p.userId = :userId
                    and p.notifyAnalysisDone = false and p.notifyChallenge = false and p.notifyEveningReminder = false)
on conflict(token) do update set userId = excluded.userId, platform = excluded.platform,
    locale = excluded.locale, appVersion = excluded.appVersion, updatedAt = current_timestamp
```

오류: `IllegalArgumentException: org.hibernate.query.SemanticException: Could not interpret path expression 'token' ← SemanticException: Could not interpret path expression 'token'`

### 다시 쓰기: id 를 앱이 넘기고, 이어서 token 으로 id 를 읽음(문장 둘) — 안 된다

```
insert into ProbePushToken(id, userId, token, platform, locale, appVersion)
select :id, :userId, :token, :platform, :locale, :appVersion
where not exists (select 1 from ProbeUserProfile p where p.userId = :userId
                    and p.notifyAnalysisDone = false and p.notifyChallenge = false and p.notifyEveningReminder = false)
on conflict(token) do update set userId = excluded.userId, platform = excluded.platform,
    locale = excluded.locale, appVersion = excluded.appVersion, updatedAt = current_timestamp
```

오류: `IllegalArgumentException: org.hibernate.query.SemanticException: Could not interpret path expression 'token' ← SemanticException: Could not interpret path expression 'token'`

### insert … select + on conflict on constraint(제약 이름) — 안 된다

```
insert into ProbePushToken(id, userId, token, platform, locale, appVersion)
select :id, :userId, :token, :platform, :locale, :appVersion
where not exists (select 1 from ProbeUserProfile p where p.userId = :userId
                    and p.notifyAnalysisDone = false and p.notifyChallenge = false and p.notifyEveningReminder = false)
on conflict on constraint push_tokens_token_key do update set userId = excluded.userId, platform = excluded.platform,
    locale = excluded.locale, appVersion = excluded.appVersion, updatedAt = current_timestamp
```

오류: `IllegalArgumentException: org.hibernate.query.SemanticException: Could not interpret path expression 'userId' ← SemanticException: Could not interpret path expression 'userId'`

### 다시 쓰기: 토글을 따로 읽고 insert … values … on conflict(token), 이어서 id 를 읽음(문장 셋) — 된다

```
select count(*) from ProbeUserProfile p where p.userId = :userId
  and p.notifyAnalysisDone = false and p.notifyChallenge = false and p.notifyEveningReminder = false

insert into ProbePushToken(id, userId, token, platform, locale, appVersion)
values (:id, :userId, :token, :platform, :locale, :appVersion)
on conflict(token) do update set userId = excluded.userId, platform = excluded.platform,
    locale = excluded.locale, appVersion = excluded.appVersion, updatedAt = current_timestamp
```

Hibernate 가 보낸 SQL:

```sql
select count(*) from user_profiles pup1_0 where pup1_0.user_id=? and pup1_0.notify_analysis_done=false and pup1_0.notify_challenge=false and pup1_0.notify_evening_reminder=false;
insert into push_tokens as ppt1_0(id,user_id,token,platform,locale,app_version) values (?,?,?,?,?,?) on conflict(token) do update set user_id=excluded.user_id,platform=excluded.platform,locale=excluded.locale,app_version=excluded.app_version,updated_at=localtimestamp;
select ppt1_0.id from push_tokens ppt1_0 where ppt1_0.token=?;
```

관찰: `영향 행 1, id=9e600210-fc8a-4d0c-87c2-c8aad7e81539`

- insert … select 에 on conflict … do update 를 붙이면 충돌 대상을 열 이름으로 주든 제약 이름으로 주든 Hibernate 가 set 절의 경로를 풀지 못했다. insert … values … do update(P07)와 insert … select … do nothing(P22)은 된다.

## P11 읽기만 하는 CTE + FILTER + = ANY(string_to_array)

원본 `PostgresBillingAdminReader#signedUpBefore#1`

```sql
WITH team AS (
  SELECT id FROM users
  WHERE lower(btrim(COALESCE(email, ''))) = ANY(string_to_array(:teamEmails, ','))
     OR left(md5(CAST(id AS text)), 8) = ANY(string_to_array(:teamActors, ','))
)
SELECT count(*) AS users, count(*) FILTER (WHERE u.id IN (SELECT id FROM team)) AS team
FROM users AS u
WHERE u.created_at < CAST(:cutoff AS timestamptz) AND u.deactivated_at IS NULL AND u.retention_purged_at IS NULL
```

### HQL md5() 를 그대로 씀 — 안 된다

```
with team as (
  select u.id as id from ProbeUser u
  where lower(trim(coalesce(u.email, ''))) in :teamEmails
     or left(md5(cast(u.id as String)), 8) in :teamActors
)
select count(*) as users, count(*) filter (where u.id in (select t.id from team t)) as team
from ProbeUser u
where u.createdAt < :cutoff and u.deactivatedAt is null and u.retentionPurgedAt is null
```

오류: `IllegalArgumentException: org.hibernate.query.sqm.produce.function.FunctionArgumentException: Parameter 1 of function 'left()' has type 'STRING', but argument is of type 'byte[]' mapped to 'VARBINARY' ← FunctionArgumentException: Parameter 1 of function 'left()' has type 'STRING', but argument is of type 'byte[]' mapped to 'VARBINARY'`

### HQL with … select, md5 를 문자열로 cast, 목록은 Java 에서 나눈 List 로 — 된다

```
with team as (
  select u.id as id from ProbeUser u
  where lower(trim(coalesce(u.email, ''))) in :teamEmails
     or left(cast(md5(cast(u.id as String)) as String), 8) in :teamActors
)
select count(*) as users, count(*) filter (where u.id in (select t.id from team t)) as team
from ProbeUser u
where u.createdAt < :cutoff and u.deactivatedAt is null and u.retentionPurgedAt is null
```

Hibernate 가 보낸 SQL:

```sql
with team (id) as (select pu1_0.id from users pu1_0 where lower(trim(BOTH from coalesce(pu1_0.email,''))) in (?) or left(cast(decode(md5(cast(pu1_0.id as varchar)), 'hex') as varchar),8) in (?)) select count(*),count(*) filter (where pu2_0.id in (select t1_0.id from team t1_0)) from users pu2_0 where pu2_0.created_at<? and pu2_0.deactivated_at is null and pu2_0.retention_purged_at is null;
```

관찰: `[[2, 1]]`

- 결과 같음(시드): 예 — 네이티브 [[2, 1]] / HQL [[2, 1]]

## P12 WITH RECURSIVE

원본 `PostgresLegacyPracticeReader#find#1(앞부분)`

```sql
WITH RECURSIVE chain(id, root_id, ordinal) AS (
    SELECT ps.id, ps.id, 1 FROM practice_sessions ps WHERE ps.continued_from IS NULL
    UNION ALL
    SELECT child.id, chain.root_id, chain.ordinal + 1
    FROM practice_sessions child JOIN chain ON child.continued_from = chain.id
    WHERE chain.ordinal < 100
)
SELECT id, root_id, ordinal FROM chain ORDER BY ordinal
```

### HQL 재귀 CTE(자기 참조) — 된다

```
with chain as (
    select ps.id as id, ps.id as rootId, 1 as ordinal from ProbePracticeSession ps where ps.continuedFrom is null
    union all
    select child.id as id, c.rootId as rootId, c.ordinal + 1 as ordinal
    from ProbePracticeSession child join chain c on child.continuedFrom = c.id
    where c.ordinal < 100
)
select c.id, c.rootId, c.ordinal from chain c order by c.ordinal
```

Hibernate 가 보낸 SQL:

```sql
with recursive chain (id,rootId,ordinal) as (select pps1_0.id,pps1_0.id,1 from practice_sessions pps1_0 where pps1_0.continued_from is null union all select pps2_0.id,c1_0.rootId,(c1_0.ordinal+1) from practice_sessions pps2_0 join chain c1_0 on pps2_0.continued_from=c1_0.id where c1_0.ordinal<100) select c2_0.id,c2_0.rootId,c2_0.ordinal from chain c2_0 order by c2_0.ordinal;
```

관찰: `[[00000000-0000-0000-0000-000000000051, 00000000-0000-0000-0000-000000000051, 1], [00000000-0000-0000-0000-000000000052, 00000000-0000-0000-0000-000000000051, 2], [00000000-0000-0000-0000-000000000053, 00000000-0000-0000-0000-000000000051, 3]]`

- 결과 같음(시드 사슬 셋): 예 — 네이티브 [[00000000-0000-0000-0000-000000000051, 00000000-0000-0000-0000-000000000051, 1], [00000000-0000-0000-0000-000000000052, 00000000-0000-0000-0000-000000000051, 2], [00000000-0000-0000-0000-000000000053, 00000000-0000-0000-0000-000000000051, 3]] / HQL [[00000000-0000-0000-0000-000000000051, 00000000-0000-0000-0000-000000000051, 1], [00000000-0000-0000-0000-000000000052, 00000000-0000-0000-0000-000000000051, 2], [00000000-0000-0000-0000-000000000053, 00000000-0000-0000-0000-000000000051, 3]]

- practice_sessions 는 CONTRACT §5-1 이 매핑을 은퇴시킨 표다. HQL 로 옮기려면 은퇴한 매핑을 되살려야 한다.

## P13 JSON 읽기 ->·->>

원본 `PostgresCoachFlows#assign#2`

```sql
SELECT count(*) FILTER (WHERE c.state->'practice_loop'->>'flow'='b') AS b,
       count(*) FILTER (WHERE c.state->'practice_loop'->>'flow'='a') AS a
FROM practices p JOIN coach_conversations c ON c.practice_id=p.id
WHERE p.user_id=:userId AND p.id<>:practiceId
```

### HQL json_value(앱 설정 그대로) — 안 된다

```
select count(*) filter (where json_value(c.state, '$.practice_loop.flow') = 'b') as b,
       count(*) filter (where json_value(c.state, '$.practice_loop.flow') = 'a') as a
from ProbePractice p join ProbeCoachConversation c on c.practiceId = p.id
where p.userId = :userId and p.id <> :practiceId
```

오류: `IllegalArgumentException: org.hibernate.query.SemanticException: Can't use function 'json_value', because tech preview JSON functions are not enabled. To enable, set the 'hibernate.query.hql.json_functions_enabled' setting to 'true'. [select count(*) filter (where json_value(c.state, '$.practice_loop.flow') = 'b') as b, ← SemanticException: Can't use function 'json_value', because tech preview JSON functions are not enabled. To enable, set the 'hibernate.query.hql.json_functions_enabled' setting to 'true'. [select count(*) filter (where json_value(c.state, '$.practice_loop.flow') = 'b') as b,`

### HQL json_value [json_functions_enabled=true] — 된다

```
select count(*) filter (where json_value(c.state, '$.practice_loop.flow') = 'b') as b,
       count(*) filter (where json_value(c.state, '$.practice_loop.flow') = 'a') as a
from ProbePractice p join ProbeCoachConversation c on c.practiceId = p.id
where p.userId = :userId and p.id <> :practiceId
```

Hibernate 가 보낸 SQL:

```sql
select count(*) filter (where json_value(pcc1_0.state,'$.practice_loop.flow' returning jsonb)#>>'{}'='b'),count(*) filter (where json_value(pcc1_0.state,'$.practice_loop.flow' returning jsonb)#>>'{}'='a') from practices pp1_0 join coach_conversations pcc1_0 on pcc1_0.practice_id=pp1_0.id where pp1_0.user_id=? and pp1_0.id<>?;
```

관찰: `[[1, 0]]`

### HQL sql() 조각으로 ->> 를 그대로 — 된다

```
select count(*) filter (where cast(sql('(? -> ''practice_loop'' ->> ''flow'')', c.state) as String) = 'b') as b,
       count(*) filter (where cast(sql('(? -> ''practice_loop'' ->> ''flow'')', c.state) as String) = 'a') as a
from ProbePractice p join ProbeCoachConversation c on c.practiceId = p.id
where p.userId = :userId and p.id <> :practiceId
```

Hibernate 가 보낸 SQL:

```sql
select count(*) filter (where cast((pcc1_0.state -> 'practice_loop' ->> 'flow') as varchar)='b'),count(*) filter (where cast((pcc1_0.state -> 'practice_loop' ->> 'flow') as varchar)='a') from practices pp1_0 join coach_conversations pcc1_0 on pcc1_0.practice_id=pp1_0.id where pp1_0.user_id=? and pp1_0.id<>?;
```

관찰: `[[1, 0]]`

- 결과 같음(시드(flow=b 하나)): 예 — 네이티브 [[1, 0]] / HQL [[1, 0]]

- 결과 같음(sql() 조각): 예 — 네이티브 [[1, 0]] / HQL [[1, 0]]

## P14 JSON 쓰기: CAST(:x AS jsonb), 배열 원소 거르기, 키 지우기(jsonb - key)

원본 `PostgresConversationRepository#saveLineNotes#1 · PostgresScriptRepository#deleteLine#5`

```sql
UPDATE coach_notes SET line_notes=CAST(:lineNotes AS jsonb) WHERE conversation_id=CAST(:conversationId AS uuid)
--
UPDATE reading_sessions
SET line_results=COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(line_results) e
                           WHERE e->>'line_id'<>CAST(:lineId AS text)), '[]'::jsonb),
    line_said=line_said-CAST(:lineId AS text)
WHERE script_id=:scriptId
```

### HQL update 에 JsonNode 매개변수 — 된다

```
update ProbeCoachNote n set n.lineNotes = :lineNotes where n.conversationId = :conversationId
```

Hibernate 가 보낸 SQL:

```sql
update coach_notes pcn1_0 set line_notes=? where pcn1_0.conversation_id=?;
```

관찰: `0`

### HQL json_remove 로 키 지우기 — 된다

```
update ProbeReadingSession s set s.lineSaid = json_remove(s.lineSaid, :path) where s.scriptId = :scriptId
```

Hibernate 가 보낸 SQL:

```sql
update reading_sessions prs1_0 set line_said=prs1_0.line_said#-array['"00000000-0000-0000-0000-0000000000f1"']::text[] where prs1_0.script_id=?;
select prs1_0.id,prs1_0.line_results,prs1_0.line_said,prs1_0.my_character_ids,prs1_0.script_id,prs1_0.started_at,prs1_0.status,prs1_0.user_id from reading_sessions prs1_0 where prs1_0.id=?;
```

관찰: `2행, 남은 값={"00000000-0000-0000-0000-0000000000f1":"a","00000000-0000-0000-0000-0000000000f2":"b"}`

### HQL json_query 로 배열 원소 거르기(앱 설정 그대로) — 안 된다

```
update ProbeReadingSession s
set s.lineResults = coalesce(json_query(s.lineResults, '$[*] ? (@.line_id != $id)' passing :lineId as id with wrapper), '[]')
where s.scriptId = :scriptId
```

오류: `IllegalArgumentException: org.hibernate.query.SemanticException: Can't use function 'json_query', because tech preview JSON functions are not enabled. To enable, set the 'hibernate.query.hql.json_functions_enabled' setting to 'true'. [update ProbeReadingSession s ← SemanticException: Can't use function 'json_query', because tech preview JSON functions are not enabled. To enable, set the 'hibernate.query.hql.json_functions_enabled' setting to 'true'. [update ProbeReadingSession s`

### HQL json_query 로 배열 원소 거르기 [json_functions_enabled=true] — 된다

```
update ProbeReadingSession s
set s.lineResults = coalesce(json_query(s.lineResults, '$[*] ? (@.line_id != $id)' passing :lineId as id with wrapper), '[]')
where s.scriptId = :scriptId
```

Hibernate 가 보낸 SQL:

```sql
update reading_sessions prs1_0 set line_results=coalesce(json_query(prs1_0.line_results,'$[*] ? (@.line_id != $id)' passing ? as "id" with wrapper),'[]') where prs1_0.script_id=?;
select prs1_0.id,prs1_0.line_results,prs1_0.line_said,prs1_0.my_character_ids,prs1_0.script_id,prs1_0.started_at,prs1_0.status,prs1_0.user_id from reading_sessions prs1_0 where prs1_0.id=?;
```

관찰: `2행, 남은 값=[{"ok":false,"line_id":"00000000-0000-0000-0000-0000000000f2"}]`

- json_remove 에 따옴표로 감싼 키 경로($."<uuid>")를 주면 Hibernate 가 따옴표째 키로 바꿔(#- array['"…"']) 오류 없이 아무것도 지우지 않는다. UUID 처럼 '-' 가 든 키는 따옴표 없이 쓸 수 없다.

- 결과 같음(시드 회차 하나): 아니오 — 네이티브 [[[{"ok": false, "line_id": "00000000-0000-0000-0000-0000000000f2"}], {"00000000-0000-0000-0000-0000000000f2": "b"}]] / HQL [[[{"ok": false, "line_id": "00000000-0000-0000-0000-0000000000f2"}], {"00000000-0000-0000-0000-0000000000f1": "a", "00000000-0000-0000-0000-0000000000f2": "b"}]]

## P15 LEFT JOIN LATERAL + FROM 절 서브쿼리

원본 `PostgresCloudVoiceRepository#consent#2`

```sql
SELECT last_decision.action
FROM (SELECT id FROM consent_documents WHERE type='cloud_voice' AND locale='ko'
      ORDER BY published_at DESC,id DESC LIMIT 1) current_document
LEFT JOIN LATERAL (SELECT action FROM user_consents
                   WHERE user_id=:userId AND document_id=current_document.id
                   ORDER BY occurred_at DESC,id DESC LIMIT 1) last_decision ON true
```

### HQL join lateral — 된다

```
select ld.action as action
from (select d.id as id from ProbeConsentDocument d where d.type = 'cloud_voice' and d.locale = 'ko'
      order by d.publishedAt desc, d.id desc limit 1) cd
left join lateral (select c.action as action from ProbeUserConsent c
                   where c.userId = :userId and c.documentId = cd.id
                   order by c.occurredAt desc, c.id desc limit 1) ld on true
```

Hibernate 가 보낸 SQL:

```sql
select ld1_0.c0 from (select pcd1_0.id from consent_documents pcd1_0 where pcd1_0.type='cloud_voice' and pcd1_0.locale='ko' order by pcd1_0.published_at desc,pcd1_0.id desc fetch first 1 rows only) cd1_0(c0) left join lateral (select puc1_0.action from user_consents puc1_0 where puc1_0.user_id=? and puc1_0.document_id=cd1_0.c0 order by puc1_0.occurred_at desc,puc1_0.id desc fetch first 1 rows only) ld1_0(c0) on true;
```

관찰: `[[granted]]`

- 결과 같음(U1): 예 — 네이티브 [[granted]] / HQL [[granted]]

- 결과 같음(U2): 예 — 네이티브 [[declined]] / HQL [[declined]]

## P16 집계 FILTER + GROUP BY + CAST(date AS text)

원본 `PostgresAdRepository#dailyEvents#1`

```sql
SELECT CAST(day AS text) AS day,
       count(*) FILTER (WHERE event='impression') AS impressions,
       count(*) FILTER (WHERE event='click') AS clicks
FROM ad_events WHERE ad_id=:id AND day BETWEEN :from AND :to
GROUP BY day ORDER BY day
```

### HQL count(*) filter — 된다

```
select cast(e.day as String) as day,
       count(*) filter (where e.event = 'impression') as impressions,
       count(*) filter (where e.event = 'click') as clicks
from ProbeAdEvent e where e.adId = :id and e.day between :from and :to
group by e.day order by e.day
```

Hibernate 가 보낸 SQL:

```sql
select cast(pae1_0.day as varchar),count(*) filter (where pae1_0.event='impression'),count(*) filter (where pae1_0.event='click') from ad_events pae1_0 where pae1_0.ad_id=? and pae1_0.day between ? and ? group by pae1_0.day order by pae1_0.day;
```

관찰: `[[2026-11-01, 2, 1], [2026-11-02, 1, 0]]`

- 결과 같음(시드 이틀): 예 — 네이티브 [[2026-11-01, 2, 1], [2026-11-02, 1, 0]] / HQL [[2026-11-01, 2, 1], [2026-11-02, 1, 0]]

## P17 DISTINCT ON

원본 `PostgresConsentRepository#currentConsentsOf#1`

```sql
SELECT DISTINCT ON(document_id) id,user_id,document_id,action,occurred_at
FROM user_consents WHERE user_id=:userId
ORDER BY document_id,occurred_at DESC,id DESC
```

### HQL distinct on — 안 된다

```
select distinct on (c.documentId) c.id, c.userId, c.documentId, c.action, c.occurredAt
from ProbeUserConsent c where c.userId = :userId order by c.documentId, c.occurredAt desc, c.id desc
```

오류: `IllegalArgumentException: org.hibernate.query.SyntaxException: At 1:35 and token '.', mismatched input '.', expecting one of the following tokens: <EOF>, ',', EXCEPT, FETCH, FROM, GROUP, HAVING, INTERSECT, LIMIT, OFFSET, ORDER, UNION, WHERE [select distinct on (c.documentId) c.id, c.userId, c.documentId, c.action, c.occurredAt ← SyntaxException: At 1:35 and token '.', mismatched input '.', expecting one of the following tokens: <EOF>, ',', EXCEPT, FETCH, FROM, GROUP, HAVING, INTERSECT, LIMIT, OFFSET, ORDER, UNION, WHERE [select distinct on (c.documentId) c.id, c.userId, c.documentId, c.action, c.occurredAt`

### 다시 쓰기: row_number() over(partition by) = 1 — 된다

```
select x.id, x.userId, x.documentId, x.action, x.occurredAt
from (select c.id as id, c.userId as userId, c.documentId as documentId, c.action as action,
             c.occurredAt as occurredAt,
             row_number() over (partition by c.documentId order by c.occurredAt desc, c.id desc) as rn
      from ProbeUserConsent c where c.userId = :userId) x
where x.rn = 1 order by x.documentId
```

Hibernate 가 보낸 SQL:

```sql
select x1_0.c0,x1_0.c1,x1_0.c2,x1_0.c3,x1_0.c4 from (select puc1_0.id,puc1_0.user_id,puc1_0.document_id,puc1_0.action,puc1_0.occurred_at,row_number() over(partition by puc1_0.document_id order by puc1_0.occurred_at desc,puc1_0.id desc) from user_consents puc1_0 where puc1_0.user_id=?) x1_0(c0,c1,c2,c3,c4,c5) where x1_0.c5=1 order by x1_0.c2;
```

관찰: `[[affc6dd5-c7cb-4b38-b464-d6f471df9dd6, 00000000-0000-0000-0000-0000000000a1, 00000000-0000-0000-0000-0000000000d1, revoked, 2026-02-02T00:00:00Z], [27bfb06d-87a0-4c5f-889f-171069ff39d6, 00000000-0000-0000-0000-0000000000a1, 00000000-0000-0000-0000-0000000000d2, granted, 2026-03-02T00:00:00Z], [9b9a3c14-3fa6-4142-b225-016079b24a12, 00000000-0000-0000-0000-0000000000a1, 00000000-0000-0000-0000-0000000000d3, granted, 2026-01-02T00:00:00Z]]`

- 결과 같음(U1 문서 셋): 예 — 네이티브 [[affc6dd5-c7cb-4b38-b464-d6f471df9dd6, 00000000-0000-0000-0000-0000000000a1, 00000000-0000-0000-0000-0000000000d1, revoked, 2026-02-02T00:00:00Z], [27bfb06d-87a0-4c5f-889f-171069ff39d6, 00000000-0000-0000-0000-0000000000a1, 00000000-0000-0000-0000-0000000000d2, granted, 2026-03-02T00:00:00Z], [9b9a3c14-3fa6-4142-b225-016079b24a12, 00000000-0000-0000-0000-0000000000a1, 00000000-0000-0000-0000-0000000000d3, granted, 2026-01-02T00:00:00Z]] / HQL [[affc6dd5-c7cb-4b38-b464-d6f471df9dd6, 00000000-0000-0000-0000-0000000000a1, 00000000-0000-0000-0000-0000000000d1, revoked, 2026-02-02T00:00:00Z], [27bfb06d-87a0-4c5f-889f-171069ff39d6, 00000000-0000-0000-0000-0000000000a1, 00000000-0000-0000-0000-0000000000d2, granted, 2026-03-02T00:00:00Z], [9b9a3c14-3fa6-4142-b225-016079b24a12, 00000000-0000-0000-0000-0000000000a1, 00000000-0000-0000-0000-0000000000d3, granted, 2026-01-02T00:00:00Z]]

## P18 창 함수 rank() OVER + UPDATE … FROM (서브쿼리)

원본 `ChallengeSettlement#confirm#2`

```sql
UPDATE challenge_entries e SET final_rank=ranked.position,updated_at=:now
FROM (SELECT id,rank() OVER (ORDER BY final_like_count DESC) AS position
      FROM challenge_entries WHERE challenge_id=:id AND final_eligible AND status='visible') ranked
WHERE e.id=ranked.id
```

### HQL update set = (FROM 절 서브쿼리 안의 창 함수) — 된다

```
update ProbeEntry e
set e.finalRank = (select r.position from (select x.id as id, rank() over (order by x.finalLikeCount desc) as position
                                           from ProbeEntry x
                                           where x.challengeId = :id and x.finalEligible = true and x.status = 'visible') r
                   where r.id = e.id),
    e.updatedAt = :now
where e.challengeId = :id and e.finalEligible = true and e.status = 'visible'
```

Hibernate 가 보낸 SQL:

```sql
update challenge_entries pe1_0 set final_rank=(select r1_0.c1 from (select pe2_0.id,rank() over(order by pe2_0.final_like_count desc) from challenge_entries pe2_0 where pe2_0.challenge_id=? and pe2_0.final_eligible=true and pe2_0.status='visible') r1_0(c0,c1) where r1_0.c0=pe1_0.id),updated_at=? where pe1_0.challenge_id=? and pe1_0.final_eligible=true and pe1_0.status='visible';
SELECT id, final_rank FROM challenge_entries WHERE challenge_id=? ORDER BY id;
```

관찰: `3행`

- 결과 같음(참여작 넷(공동 1위 둘)): 예 — 네이티브 [[00000000-0000-0000-0000-0000000000e1, 1], [00000000-0000-0000-0000-0000000000e2, 3], [00000000-0000-0000-0000-0000000000e3, 1], [00000000-0000-0000-0000-0000000000e4, null]] / HQL [[00000000-0000-0000-0000-0000000000e1, 1], [00000000-0000-0000-0000-0000000000e2, 3], [00000000-0000-0000-0000-0000000000e3, 1], [00000000-0000-0000-0000-0000000000e4, null]]

## P19 배열: = ANY(CAST(:ids AS uuid[])) · unnest · array_to_string

원본 `PostgresCommunityRepository#withImages#1 · PostgresReadingVoiceMaterials#material#2 · PostgresSessionRepository#start#3`

```sql
SELECT id AS id, post_id AS post_id, object_key AS object_key FROM community_post_images
WHERE post_id = ANY (CAST(:ids AS uuid[])) ORDER BY post_id, sort_order
--
SELECT unnest(my_character_ids) AS id FROM reading_sessions WHERE id=:readingSessionId
--
SELECT id,array_to_string(member_ids,:sep) AS member_ids FROM script_characters WHERE script_id=:scriptId
```

### IN 목록 매개변수(List) — 된다

```
select i.objectKey from ProbePostImage i where i.postId in :ids order by i.postId, i.sortOrder
```

Hibernate 가 보낸 SQL:

```sql
select ppi1_0.object_key from community_post_images ppi1_0 where ppi1_0.post_id in (?,?,?) order by ppi1_0.post_id,ppi1_0.sort_order;
```

관찰: `[img/1, img/2]`

### array_contains(배열 매개변수 하나) — 된다

```
select i.objectKey from ProbePostImage i where array_contains(:ids, i.postId) order by i.postId, i.sortOrder
```

Hibernate 가 보낸 SQL:

```sql
select ppi1_0.object_key from community_post_images ppi1_0 where ?@>array[ppi1_0.post_id] order by ppi1_0.post_id,ppi1_0.sort_order;
```

관찰: `[img/1, img/2]`

### HQL join unnest(집합 반환 함수) — 안 된다

```
select e from ProbeReadingSession s join unnest(s.myCharacterIds) e where s.id = :id
```

오류: `IllegalArgumentException: Could not construct set-returning function. Maybe you forgot to use 'lateral'? ← SqlTreeCreationException: Could not locate TableGroup - com.acttub.jpqlprobe.ProbeEntities$ProbeReadingSession(s)`

### HQL join lateral unnest(집합 반환 함수) — 된다

```
select e from ProbeReadingSession s join lateral unnest(s.myCharacterIds) e where s.id = :id
```

Hibernate 가 보낸 SQL:

```sql
select e1_0.e1_0 from reading_sessions prs1_0 join lateral unnest(prs1_0.my_character_ids) e1_0 on true where prs1_0.id=?;
```

관찰: `[00000000-0000-0000-0000-0000000000f6, 00000000-0000-0000-0000-0000000000f7]`

### 엔티티로 읽고 배열을 Java 에서 펼침 — 된다

```
session.find(ProbeReadingSession.class, id).myCharacterIds
```

Hibernate 가 보낸 SQL:

```sql
select prs1_0.id,prs1_0.line_results,prs1_0.line_said,prs1_0.my_character_ids,prs1_0.script_id,prs1_0.started_at,prs1_0.status,prs1_0.user_id from reading_sessions prs1_0 where prs1_0.id=?;
```

관찰: `[00000000-0000-0000-0000-0000000000f6, 00000000-0000-0000-0000-0000000000f7]`

### HQL array_to_string — 된다

```
select c.id, array_to_string(c.memberIds, :sep) from ProbeScriptCharacter c where c.scriptId = :scriptId
```

Hibernate 가 보낸 SQL:

```sql
select psc1_0.id,array_to_string(psc1_0.member_ids,cast(? as varchar)) from script_characters psc1_0 where psc1_0.script_id=?;
```

관찰: `[[00000000-0000-0000-0000-0000000000f8, 00000000-0000-0000-0000-0000000000f6,00000000-0000-0000-0000-0000000000f7], [00000000-0000-0000-0000-0000000000f6, null], [00000000-0000-0000-0000-0000000000f7, null]]`

- 결과 같음(array_to_string): 예 — 네이티브 [[00000000-0000-0000-0000-0000000000f8, 00000000-0000-0000-0000-0000000000f6,00000000-0000-0000-0000-0000000000f7], [00000000-0000-0000-0000-0000000000f6, null], [00000000-0000-0000-0000-0000000000f7, null]] / HQL [[00000000-0000-0000-0000-0000000000f8, 00000000-0000-0000-0000-0000000000f6,00000000-0000-0000-0000-0000000000f7], [00000000-0000-0000-0000-0000000000f6, null], [00000000-0000-0000-0000-0000000000f7, null]]

- 결과 같음(unnest): 예 — 네이티브 [[00000000-0000-0000-0000-0000000000f6], [00000000-0000-0000-0000-0000000000f7]] / HQL [[00000000-0000-0000-0000-0000000000f6], [00000000-0000-0000-0000-0000000000f7]]

## P20 UPDATE … FROM 다른 표

원본 `PostgresScriptImportRepository#linkUpload#1`

```sql
UPDATE script_uploads u SET script_id=:scriptId,raw_text=NULL,updated_at=:now
FROM script_imports i WHERE i.id=:importId AND u.id=i.upload_id AND u.script_id IS NULL
```

### HQL update … from — 안 된다

```
update ProbeScriptUpload u set u.scriptId = :scriptId from ProbeScriptImport i where i.id = :importId and u.id = i.uploadId
```

오류: `IllegalArgumentException: org.hibernate.query.SyntaxException: At 1:54 and token 'from', no viable alternative at input 'update ProbeScriptUpload u set u.scriptId = :scriptId *from ProbeScriptImport i where i.id = :importId and u.id = i.uploadId' [update ProbeScriptUpload u set u.scriptId = :scriptId from ProbeScriptImport i where i.id = :importId and u.id = i.uploadId] ← SyntaxException: At 1:54 and token 'from', no viable alternative at input 'update ProbeScriptUpload u set u.scriptId = :scriptId *from ProbeScriptImport i where i.id = :importId and u.id = i.uploadId' [update ProbeScriptUpload u set u.scriptId = :scriptId from ProbeScriptImport i where i.id = :importId and u.id = i.uploadId]`

### 다시 쓰기: where exists(상관 서브쿼리) — 된다

```
update ProbeScriptUpload u set u.scriptId = :scriptId, u.rawText = null, u.updatedAt = :now
where u.scriptId is null and exists (select 1 from ProbeScriptImport i where i.id = :importId and i.uploadId = u.id)
```

Hibernate 가 보낸 SQL:

```sql
update script_uploads psu1_0 set script_id=?,raw_text=null,updated_at=? where psu1_0.script_id is null and exists(select 1 from script_imports psi1_0 where psi1_0.id=? and psi1_0.upload_id=psu1_0.id);
```

관찰: `1행`

## P21 DELETE … USING 다른 표

원본 `PostgresScriptRepository#delete#4`

```sql
DELETE FROM line_memorization m USING script_lines l WHERE l.id=m.line_id AND l.script_id=:scriptId
```

### HQL delete … using — 안 된다

```
delete from ProbeLineMemorization m using ProbeScriptLine l where l.id = m.lineId and l.scriptId = :scriptId
```

오류: `IllegalArgumentException: org.hibernate.query.SyntaxException: At 1:36 and token 'using', mismatched input 'using', expecting one of the following tokens: <EOF>, ',', CROSS, FULL, INNER, JOIN, LEFT, OUTER, RIGHT, WHERE [delete from ProbeLineMemorization m using ProbeScriptLine l where l.id = m.lineId and l.scriptId = :scriptId] ← SyntaxException: At 1:36 and token 'using', mismatched input 'using', expecting one of the following tokens: <EOF>, ',', CROSS, FULL, INNER, JOIN, LEFT, OUTER, RIGHT, WHERE [delete from ProbeLineMemorization m using ProbeScriptLine l where l.id = m.lineId and l.scriptId = :scriptId]`

### 다시 쓰기: where … in (서브쿼리) — 된다

```
delete from ProbeLineMemorization m where m.lineId in (select l.id from ProbeScriptLine l where l.scriptId = :scriptId)
```

Hibernate 가 보낸 SQL:

```sql
delete from line_memorization plm1_0 where plm1_0.line_id in (select psl1_0.id from script_lines psl1_0 where psl1_0.script_id=?);
```

관찰: `2행`

## P22 INSERT … SELECT … ON CONFLICT DO NOTHING

원본 `PostgresAuthRepository#recordActiveDay#1`

```sql
INSERT INTO user_active_days(user_id,day) SELECT id,:day FROM users WHERE id=:userId AND deactivated_at IS NULL ON CONFLICT DO NOTHING
```

### HQL insert … select … on conflict do nothing 를 두 번 — 된다

```
insert into ProbeUserActiveDay(userId, day)
select u.id, :day from ProbeUser u where u.id = :userId and u.deactivatedAt is null
on conflict do nothing
```

Hibernate 가 보낸 SQL:

```sql
insert into user_active_days as puad1_0(user_id,day) select pu1_0.id,? from users pu1_0 where pu1_0.id=? and pu1_0.deactivated_at is null on conflict do nothing;
insert into user_active_days as puad1_0(user_id,day) select pu1_0.id,? from users pu1_0 where pu1_0.id=? and pu1_0.deactivated_at is null on conflict do nothing;
```

관찰: `영향 행 1 다음 0`

### HQL insert … select … order by … limit :batch … on conflict do nothing — 된다

```
insert into ProbeUserActiveDay(userId, day)
select u.id, :day from ProbeUser u where u.deactivatedAt is null order by u.createdAt, u.id limit :batch
on conflict do nothing
```

Hibernate 가 보낸 SQL:

```sql
insert into user_active_days as puad1_0(user_id,day) select pu1_0.id,? from users pu1_0 where pu1_0.deactivated_at is null order by pu1_0.created_at,pu1_0.id fetch first ? rows only on conflict do nothing;
```

관찰: `1행`

## P23 정규식 ~ · substring FROM · 스칼라 서브쿼리 LIMIT 1 · FROM 없는 SELECT

원본 `PostgresCloudVoiceRepository#consent#1`

```sql
SELECT EXISTS (SELECT 1 FROM consent_documents pd
        WHERE pd.type='privacy'
          AND (CASE WHEN pd.version ~ '^v[0-9]+$' THEN CAST(substring(pd.version FROM 2) AS integer) ELSE 0 END) >= 9
          AND (SELECT pc.action FROM user_consents pc
               WHERE pc.user_id=:userId AND pc.document_id=pd.id
               ORDER BY pc.occurred_at DESC,pc.id DESC LIMIT 1)='granted') AS covered
```

### HQL regexp_like, FROM 없는 select exists — 된다

```
select exists (select 1 from ProbeConsentDocument pd
        where pd.type = 'privacy'
          and (case when regexp_like(pd.version, '^v[0-9]+$') then cast(substring(pd.version, 2) as Integer) else 0 end) >= 9
          and (select pc.action from ProbeUserConsent pc
               where pc.userId = :userId and pc.documentId = pd.id
               order by pc.occurredAt desc, pc.id desc limit 1) = 'granted') as covered
```

Hibernate 가 보낸 SQL:

```sql
select exists(select 1 from consent_documents pcd1_0 where pcd1_0.type='privacy' and case when (pcd1_0.version~'^v[0-9]+$') then cast(substr(pcd1_0.version,2) as integer) else 0 end>=9 and (select puc1_0.action from user_consents puc1_0 where puc1_0.user_id=? and puc1_0.document_id=pcd1_0.id order by puc1_0.occurred_at desc,puc1_0.id desc fetch first 1 rows only)='granted');
```

관찰: `[[true]]`

### regexp_replace(등록되지 않은 함수를 이름으로 부름) — 된다

```
select regexp_replace(pd.version, '[0-9]', '#', 'g') from ProbeConsentDocument pd where pd.id = :id
```

Hibernate 가 보낸 SQL:

```sql
select regexp_replace(pcd1_0.version,'[0-9]','#','g') from consent_documents pcd1_0 where pcd1_0.id=?;
```

관찰: `[v##]`

- 결과 같음(U1(v10 동의)): 예 — 네이티브 [[true]] / HQL [[true]]

- 결과 같음(U2(동의 없음)): 예 — 네이티브 [[false]] / HQL [[false]]

## P24 string_agg(… ORDER BY …)

원본 `PostgresProfileRepository#find#1(부분)`

```sql
SELECT (SELECT string_agg(direction, ',' ORDER BY CASE direction WHEN 'media' THEN 1 WHEN 'stage' THEN 2 END)
        FROM user_profile_directions WHERE user_profile_directions.user_id=users.id) AS directions
FROM users WHERE users.id=:id
```

### HQL listagg … within group — 된다

```
select (select listagg(d.direction, ',') within group (order by case d.direction when 'media' then 1 when 'stage' then 2 end)
        from ProbeProfileDirection d where d.userId = u.id) as directions
from ProbeUser u where u.id = :id
```

Hibernate 가 보낸 SQL:

```sql
select (select string_agg(ppd1_0.direction,',' order by case ppd1_0.direction when 'media' then 1 when 'stage' then 2 end) from user_profile_directions ppd1_0 where ppd1_0.user_id=pu1_0.id) from users pu1_0 where pu1_0.id=?;
```

관찰: `[[media,stage]]`

- 결과 같음(방향 둘): 예 — 네이티브 [[media,stage]] / HQL [[media,stage]]

## P25 조건부 UPDATE 의 영향 행 수 + GREATEST + 열 증감

원본 `PostgresRetranscribeRepository#release#1`

```sql
UPDATE reading_recording_retranscripts
SET status='queued', attempt_count=GREATEST(attempt_count-1,0), lease_token=NULL, lease_until=NULL,
    updated_at=CAST(:now AS timestamptz)
WHERE recording_id=:id AND lease_token=:token AND status='running'
```

### HQL update 를 두 번(두 번째는 조건이 안 맞음) — 된다

```
update ProbeRetranscript r
set r.status = 'queued', r.attemptCount = greatest(r.attemptCount - 1, 0), r.leaseToken = null,
    r.leaseUntil = null, r.updatedAt = :now
where r.recordingId = :id and r.leaseToken = :token and r.status = 'running'
```

Hibernate 가 보낸 SQL:

```sql
update reading_recording_retranscripts pr1_0 set status='queued',attempt_count=greatest((pr1_0.attempt_count-1),0),lease_token=null,lease_until=null,updated_at=? where pr1_0.recording_id=? and pr1_0.lease_token=? and pr1_0.status='running';
update reading_recording_retranscripts pr1_0 set status='queued',attempt_count=greatest((pr1_0.attempt_count-1),0),lease_token=null,lease_until=null,updated_at=? where pr1_0.recording_id=? and pr1_0.lease_token=? and pr1_0.status='running';
```

관찰: `영향 행 1 다음 0`

- 두 트랜잭션 확인: 먼저 고친 쪽 1행, 다른 쪽은 커밋을 기다렸다(true) 조건을 다시 보고 0행 — JPQL UPDATE 한 문장이 승자 판정을 지킨다.

## P26 시간 계산: to_char · AT TIME ZONE · ::date · now() - interval

원본 `PostgresPracticeReminderRepository#recentTemplates#1 · #countedPracticeDays#1 · PostgresCoachProMemory#recent#1`

```sql
SELECT template_id, to_char(max(day),'YYYY-MM-DD') AS day FROM practice_reminder_sends
WHERE user_id=:userId AND day>=CAST(:since AS date) GROUP BY template_id
--
SELECT (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS d FROM practices p WHERE p.user_id=:userId
--
... AND c.closed_at > now() - interval '60 days'
```

### HQL format(… as 'yyyy-MM-dd') — 된다

```
select s.templateId, format(max(s.day) as 'yyyy-MM-dd') from ProbeReminderSend s
where s.userId = :userId and s.day >= :since group by s.templateId order by s.templateId
```

Hibernate 가 보낸 SQL:

```sql
select prs1_0.template_id,to_char(max(prs1_0.day),'YYYY-MM-DD') from practice_reminder_sends prs1_0 where prs1_0.user_id=? and prs1_0.day>=? group by prs1_0.template_id order by prs1_0.template_id;
```

관찰: `[[t1, 2026-11-03], [t2, 2026-11-02]]`

### AT TIME ZONE 대신 timezone() 함수를 이름으로 부름 — 된다

```
select cast(timezone('Asia/Seoul', p.createdAt) as LocalDate) from ProbePractice p where p.userId = :userId
```

Hibernate 가 보낸 SQL:

```sql
select cast(timezone('Asia/Seoul',pp1_0.created_at) as date) from practices pp1_0 where pp1_0.user_id=?;
```

관찰: `[2026-11-24]`

### HQL instant - 60 day — 된다

```
select c.id from ProbeCoachConversation c where c.closedAt > instant - 60 day
```

Hibernate 가 보낸 SQL:

```sql
select pcc1_0.id from coach_conversations pcc1_0 where pcc1_0.closed_at>cast(current_timestamp+(-60)*interval '1 day' as timestamp);
```

관찰: `[00000000-0000-0000-0000-000000000031]`

- 결과 같음(to_char): 예 — 네이티브 [[t1, 2026-11-03], [t2, 2026-11-02]] / HQL [[t1, 2026-11-03], [t2, 2026-11-02]]

- 결과 같음(서울 날짜(UTC 16:30 은 서울 다음날)): 예 — 네이티브 [[2026-11-24]] / HQL [[2026-11-24]]

- 결과 같음(now() - interval '60 days'): 예 — 네이티브 [[00000000-0000-0000-0000-000000000031]] / HQL [[00000000-0000-0000-0000-000000000031]]

- 결과 같음(now() - interval '1 day'(시드 대화는 나흘 전에 닫혀 빠져야 한다)): 예 — 네이티브 [] / HQL []

## P27 행 값 비교 (a, b) < (x, y)

원본 `PostgresCloudVoiceRepository#firstReadingSession#1`

```sql
SELECT EXISTS (SELECT 1 FROM reading_sessions s WHERE s.id=:sessionId AND s.user_id=:userId
  AND NOT EXISTS (SELECT 1 FROM reading_sessions e WHERE e.user_id=s.user_id
                    AND (e.started_at, e.id) < (s.started_at, s.id))) AS first
```

### HQL 튜플 비교 — 된다

```
select exists (select 1 from ProbeReadingSession s where s.id = :sessionId and s.userId = :userId
  and not exists (select 1 from ProbeReadingSession e where e.userId = s.userId
                    and (e.startedAt, e.id) < (s.startedAt, s.id))) as first
```

Hibernate 가 보낸 SQL:

```sql
select exists(select 1 from reading_sessions prs1_0 where prs1_0.id=? and prs1_0.user_id=? and not exists(select 1 from reading_sessions prs2_0 where prs2_0.user_id=prs1_0.user_id and (prs2_0.started_at,prs2_0.id)<(prs1_0.started_at,prs1_0.id)));
```

관찰: `[[true]]`

- 결과 같음(첫 회차): 예 — 네이티브 [[true]] / HQL [[true]]

## P28 INSERT … SELECT 안의 gen_random_uuid()

원본 `PostgresPracticeDataMigration#applyMessages#1`

```sql
INSERT INTO coach_messages(id,conversation_id,turn_index,role,text,created_at) SELECT gen_random_uuid(),e.target_id, … FROM practice_migration_entries e JOIN coach_turns t …
```

### HQL insert … select gen_random_uuid() — 안 된다

```
insert into ProbeProfileDirection(id, userId, direction) select gen_random_uuid(), u.id, 'media' from ProbeUser u where u.id = :id
```

오류: `IllegalArgumentException: org.hibernate.query.SemanticException: Cannot assign expression of type 'java.lang.Object' to target path 'alias_0.id' of type 'java.util.UUID' ← SemanticException: Cannot assign expression of type 'java.lang.Object' to target path 'alias_0.id' of type 'java.util.UUID'`

### HQL insert … select cast(gen_random_uuid() as UUID) — 안 된다

```
insert into ProbeProfileDirection(id, userId, direction) select cast(gen_random_uuid() as UUID), u.id, 'media' from ProbeUser u where u.id = :id
```

오류: `InterpretationException: Error interpreting query [unrecognized cast target type: UUID] [insert into ProbeProfileDirection(id, userId, direction) select cast(gen_random_uuid() as UUID), u.id, 'media' from ProbeUser u where u.id = :id] ← HibernateException: unrecognized cast target type: UUID`

### HQL insert … select cast(gen_random_uuid() as java.util.UUID) — 된다

```
insert into ProbeProfileDirection(id, userId, direction) select cast(gen_random_uuid() as java.util.UUID), u.id, 'media' from ProbeUser u where u.id = :id
```

Hibernate 가 보낸 SQL:

```sql
insert into user_profile_directions as ppd1_0(id,user_id,direction) select cast(gen_random_uuid() as uuid),pu1_0.id,'media' from users pu1_0 where pu1_0.id=?;
```

관찰: `1`

## P29 UNION

원본 `PostgresProfileRepository#videoKeys#1`

```sql
SELECT object_key FROM upload_intents WHERE user_id=:userId
UNION SELECT object_key FROM videos WHERE user_id=:userId AND purged_at IS NULL
UNION SELECT poster_key FROM videos WHERE user_id=:userId AND purged_at IS NULL AND poster_key IS NOT NULL
UNION SELECT mosaic_key FROM challenge_entries WHERE user_id=:userId AND mosaic_key IS NOT NULL
ORDER BY 1
```

### HQL union — 된다

```
select ui.objectKey from ProbeUploadIntent ui where ui.userId = :userId
union select v.objectKey from ProbeVideo v where v.userId = :userId and v.purgedAt is null
union select v.posterKey from ProbeVideo v where v.userId = :userId and v.purgedAt is null and v.posterKey is not null
union select e.mosaicKey from ProbeEntry e where e.userId = :userId and e.mosaicKey is not null
order by 1
```

Hibernate 가 보낸 SQL:

```sql
select pui1_0.object_key from upload_intents pui1_0 where pui1_0.user_id=? union select pv1_0.object_key from videos pv1_0 where pv1_0.user_id=? and pv1_0.purged_at is null union select pv2_0.poster_key from videos pv2_0 where pv2_0.user_id=? and pv2_0.purged_at is null and pv2_0.poster_key is not null union (select pe1_0.mosaic_key from challenge_entries pe1_0 where pe1_0.user_id=? and pe1_0.mosaic_key is not null order by 1);
```

관찰: `[[m/1], [p/1], [up/1], [up/2], [v/1]]`

- 결과 같음(U1 키): 예 — 네이티브 [[m/1], [p/1], [up/1], [up/2], [v/1]] / HQL [[m/1], [p/1], [up/1], [up/2], [v/1]]

## P30 권고 잠금 pg_advisory_xact_lock

원본 `PostgresChallengeRepository#createTeam#1`

```sql
SELECT 1 FROM pg_advisory_xact_lock(hashtext('challenge_team_create'))
```

### HQL FROM 절에 함수 — 안 된다

```
select 1 from pg_advisory_xact_lock(hashtext('challenge_team_create'))
```

오류: `IllegalArgumentException: org.hibernate.query.SemanticException: The pg_advisory_xact_lock() set-returning function was not registered for the dialect [select 1 from pg_advisory_xact_lock(hashtext('challenge_team_create'))] ← SemanticException: The pg_advisory_xact_lock() set-returning function was not registered for the dialect [select 1 from pg_advisory_xact_lock(hashtext('challenge_team_create'))]`

### HQL select 절에서 함수를 이름으로 부름 — 된다

```
select pg_advisory_xact_lock(hashtext('challenge_team_create'))
```

Hibernate 가 보낸 SQL:

```sql
select pg_advisory_xact_lock(hashtext('challenge_team_create'));
```

관찰: `[]`

### HQL function('…') 문법 — 된다

```
select function('pg_advisory_xact_lock', function('hashtext', 'challenge_team_create'))
```

Hibernate 가 보낸 SQL:

```sql
select pg_advisory_xact_lock(hashtext('challenge_team_create'));
```

관찰: `[]`

- 두 세션 확인: HQL 로 잡은 동안 다른 세션의 pg_try_advisory_xact_lock = false (잡혀 있음)

## P31 SET LOCAL · SET CONSTRAINTS

원본 `PostgresSessionRepository#saveProgress#2 · PostgresScriptRepository#update#3`

```sql
SET LOCAL synchronous_commit = off
--
SET CONSTRAINTS uq_script_characters_script_name DEFERRED
```

### HQL set local — 안 된다

```
set local synchronous_commit = off
```

오류: `IllegalArgumentException: org.hibernate.query.SyntaxException: At 1:0 and token 'set', mismatched input 'set', expecting one of the following tokens: '(', DELETE, FROM, INSERT, ORDER, SELECT, UPDATE, WHERE, WITH [set local synchronous_commit = off] ← SyntaxException: At 1:0 and token 'set', mismatched input 'set', expecting one of the following tokens: '(', DELETE, FROM, INSERT, ORDER, SELECT, UPDATE, WHERE, WITH [set local synchronous_commit = off]`

### HQL set_config(…, true) 함수 호출 — 된다

```
select set_config('synchronous_commit', 'off', true)
```

Hibernate 가 보낸 SQL:

```sql
select set_config('synchronous_commit','off',true);
SELECT current_setting('synchronous_commit');
```

관찰: `set_config=off, 같은 트랜잭션의 current_setting=off`

### HQL set constraints — 안 된다

```
set constraints uq_script_characters_script_name deferred
```

오류: `IllegalArgumentException: org.hibernate.query.SyntaxException: At 1:0 and token 'set', mismatched input 'set', expecting one of the following tokens: '(', DELETE, FROM, INSERT, ORDER, SELECT, UPDATE, WHERE, WITH [set constraints uq_script_characters_script_name deferred] ← SyntaxException: At 1:0 and token 'set', mismatched input 'set', expecting one of the following tokens: '(', DELETE, FROM, INSERT, ORDER, SELECT, UPDATE, WHERE, WITH [set constraints uq_script_characters_script_name deferred]`

## P32 SELECT 절 서브쿼리·EXISTS, IN 목록

원본 `EntryCards#cards#1(부분)`

```sql
SELECT e.id,
       (SELECT count(*) FROM entry_likes l WHERE l.entry_id=e.id) AS like_count,
       EXISTS(SELECT 1 FROM entry_likes l WHERE l.entry_id=e.id AND l.user_id=:viewer) AS liked
FROM challenge_entries e WHERE e.id IN (:ids) ORDER BY e.id
```

### HQL 스칼라 서브쿼리 — 된다

```
select e.id as id, (select count(*) from ProbeEntryLike l where l.entryId = e.id) as likeCount,
       exists (select 1 from ProbeEntryLike l where l.entryId = e.id and l.userId = :viewer) as liked
from ProbeEntry e where e.id in :ids order by e.id
```

Hibernate 가 보낸 SQL:

```sql
select pe1_0.id,(select count(*) from entry_likes pel1_0 where pel1_0.entry_id=pe1_0.id),exists(select 1 from entry_likes pel2_0 where pel2_0.entry_id=pe1_0.id and pel2_0.user_id=?) from challenge_entries pe1_0 where pe1_0.id in (?,?) order by pe1_0.id;
```

관찰: `[[00000000-0000-0000-0000-0000000000e1, 2, true], [00000000-0000-0000-0000-0000000000e2, 0, false]]`

- 결과 같음(참여작 둘): 예 — 네이티브 [[00000000-0000-0000-0000-0000000000e1, 2, true], [00000000-0000-0000-0000-0000000000e2, 0, false]] / HQL [[00000000-0000-0000-0000-0000000000e1, 2, true], [00000000-0000-0000-0000-0000000000e2, 0, false]]

## P33 FROM 없는 SELECT 1(상태 확인)

원본 `DatabaseHealthIndicator#checkDatabase#1`

```sql
SELECT 1
```

### HQL select 1 — 된다

```
select 1
```

Hibernate 가 보낸 SQL:

```sql
select 1;
```

관찰: `1`

### HQL order by … nulls last — 된다

```
select e.finalRank from ProbeEntry e where e.challengeId = :id order by e.finalRank desc nulls last, e.id
```

Hibernate 가 보낸 SQL:

```sql
select pe1_0.final_rank from challenge_entries pe1_0 where pe1_0.challenge_id=? order by pe1_0.final_rank desc nulls last,pe1_0.id;
```

관찰: `[null, null, null, null]`

## P34 상관 서브쿼리로 값을 다시 세는 UPDATE … RETURNING

원본 `PostgresCommunityRepository#resyncLikeCount#1`

```sql
WITH changed AS (
    UPDATE community_posts AS like_count_post
    SET like_count = (SELECT COUNT(*) FROM community_post_likes community_like WHERE community_like.post_id = like_count_post.id)
    WHERE like_count_post.id = :postId
    RETURNING like_count
)
SELECT like_count AS like_count FROM changed
```

### HQL update set = (상관 서브쿼리), 이어서 값을 읽음(문장 둘) — 된다

```
update ProbeCommunityPost p set p.likeCount = (select count(*) from ProbePostLike l where l.postId = p.id) where p.id = :postId
```

Hibernate 가 보낸 SQL:

```sql
update community_posts pcp1_0 set like_count=(select count(*) from community_post_likes ppl1_0 where ppl1_0.post_id=pcp1_0.id) where pcp1_0.id=?;
select pcp1_0.like_count from community_posts pcp1_0 where pcp1_0.id=?;
```

관찰: `1행, like_count=2`

## P35 HQL 안에 SQL 조각 넣기 sql('…')

원본 `(여러 곳: ->>·~·AT TIME ZONE 처럼 HQL 에 문법이 없는 연산자)`

```sql
c.state->'practice_loop'->>'flow' · pd.version ~ '^v[0-9]+$' · created_at AT TIME ZONE 'Asia/Seoul'
```

### HQL sql() 로 ->> 연산자 — 된다

```
select sql('(? -> ''practice_loop'' ->> ''flow'')', c.state) from ProbeCoachConversation c where c.id = :id
```

Hibernate 가 보낸 SQL:

```sql
select (pcc1_0.state -> 'practice_loop' ->> 'flow') from coach_conversations pcc1_0 where pcc1_0.id=?;
```

관찰: `[b]`

### HQL sql() 로 ~ 연산자(조건 자리에 그대로) — 안 된다

```
select d.version from ProbeConsentDocument d where sql('(? ~ ''^v[0-9]+$'')', d.version) order by d.version
```

오류: `IllegalArgumentException: org.hibernate.query.SemanticException: Non-boolean expression used in predicate context: sql('(? ~ ''^v[0-9]+$'')',d.version) [select d.version from ProbeConsentDocument d where sql('(? ~ ''^v[0-9]+$'')', d.version) order by d.version] ← SemanticException: Non-boolean expression used in predicate context: sql('(? ~ ''^v[0-9]+$'')',d.version) [select d.version from ProbeConsentDocument d where sql('(? ~ ''^v[0-9]+$'')', d.version) order by d.version]`

### HQL sql() 로 ~ 연산자(Boolean 으로 cast) — 된다

```
select d.version from ProbeConsentDocument d where cast(sql('(? ~ ''^v[0-9]+$'')', d.version) as Boolean) = true order by d.version
```

Hibernate 가 보낸 SQL:

```sql
select pcd1_0.version from consent_documents pcd1_0 where cast((pcd1_0.version ~ '^v[0-9]+$') as boolean)=true order by pcd1_0.version;
```

관찰: `[v1, v10, v2]`

### HQL sql() 로 AT TIME ZONE — 된다

```
select sql('(? at time zone ''Asia/Seoul'')', p.createdAt) from ProbePractice p where p.id = :id
```

Hibernate 가 보낸 SQL:

```sql
select (pp1_0.created_at at time zone 'Asia/Seoul') from practices pp1_0 where pp1_0.id=?;
```

관찰: `[2026-11-24T10:30]`

## P36 INSERT … VALUES(조건 없음)

원본 `PostgresAdRepository#recordEvent 류`

```sql
INSERT INTO ad_events(id,ad_id,day,event,slot,user_id) VALUES (:id,:adId,:day,:event,:slot,:userId)
```

### 엔티티 persist — 된다

```
session.persist(new ProbeProfileDirection(...))
```

Hibernate 가 보낸 SQL:

```sql
insert into user_profile_directions (direction,user_id,id) values (?,?,?);
```

관찰: `d511be26-8bf4-4c99-8733-aa29ae131cc3`

## P37 잠금 세기: FOR UPDATE 와 Hibernate 의 FOR NO KEY UPDATE(자식 행 INSERT 를 막는가)

원본 `PostgresPushTokenRepository#register#1 처럼 users 행을 잡는 곳`

```sql
SELECT id FROM users WHERE id=:userId AND status='active' FOR UPDATE
```

- 두 세션 확인: 한 세션이 users 행을 잡은 동안 다른 세션이 그 사용자를 가리키는 push_tokens 행을 넣으면 기다렸는가 → {네이티브 FOR UPDATE=true, HQL PESSIMISTIC_WRITE(기본 방언)=false, HQL PESSIMISTIC_WRITE(FOR UPDATE 방언)=true}. FK 검사는 부모 행에 FOR KEY SHARE 를 잡는데, FOR UPDATE 는 이것과 부딪히고 FOR NO KEY UPDATE 는 부딪히지 않는다.

## P38 한 문장 갱신을 '읽고 고치고 저장'으로 바꾸면(잃어버린 갱신)

원본 `PostgresCommunityRepository#deleteComment#2 같은 열 증감`

```sql
UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = :postId
```

- 시작 0 → 읽고 고치고 저장 두 번 뒤 1(하나를 잃음) → JPQL UPDATE 두 번 뒤 3(둘 다 반영) → PESSIMISTIC_WRITE 로 읽고 고치기 두 번 뒤 5(둘 다 반영, 대신 두 번째가 기다림).

## P39 JPQL 로 한꺼번에 고친 뒤 같은 트랜잭션의 엔티티가 든 낡은 값

원본 `CONTRACT §5-2·§5-4: native bulk 뒤 clear·재조회 규칙`

```sql
UPDATE community_posts SET comment_count = 5 WHERE id = :postId
```

### 엔티티를 읽은 뒤 JPQL UPDATE, 이어서 다른 필드를 고쳐 flush — 된다

```
update ProbeCommunityPost p set p.commentCount = 5 where p.id = :id
```

Hibernate 가 보낸 SQL:

```sql
select pcp1_0.id,pcp1_0.comment_count,pcp1_0.like_count from community_posts pcp1_0 where pcp1_0.id=?;
update community_posts pcp1_0 set comment_count=5 where pcp1_0.id=?;
update community_posts set comment_count=?,like_count=? where id=?;
SELECT comment_count FROM community_posts WHERE id=?;
```

관찰: `읽은 값 0, JPQL 뒤 엔티티 값 0, 다른 필드를 고쳐 flush 한 뒤 DB 값 0 (JPQL 이 쓴 5 가 엔티티의 낡은 값으로 덮였다)`

### JPQL UPDATE 뒤 refresh — 된다

```
update ProbeCommunityPost p set p.commentCount = 5 where p.id = :id
```

Hibernate 가 보낸 SQL:

```sql
select pcp1_0.id,pcp1_0.comment_count,pcp1_0.like_count from community_posts pcp1_0 where pcp1_0.id=?;
update community_posts pcp1_0 set comment_count=5 where pcp1_0.id=?;
select pcp1_0.id,pcp1_0.comment_count,pcp1_0.like_count from community_posts pcp1_0 where pcp1_0.id=?;
```

관찰: `refresh 뒤 엔티티 값 5`

## P40 쿼리 수: 한 쿼리의 서브쿼리 vs 행마다 저장소 메서드

원본 `EntryCards#cards#1 의 like_count`

```sql
SELECT e.id,(SELECT count(*) FROM entry_likes l WHERE l.entry_id=e.id) AS like_count FROM challenge_entries e WHERE e.id IN (:ids)
```

### HQL 한 쿼리(스칼라 서브쿼리) — 된다

```
select e.id, (select count(*) from ProbeEntryLike l where l.entryId = e.id) from ProbeEntry e where e.id in :ids
```

Hibernate 가 보낸 SQL:

```sql
select pe1_0.id,(select count(*) from entry_likes pel1_0 where pel1_0.entry_id=pe1_0.id) from challenge_entries pe1_0 where pe1_0.id in (?,?,?,?);
```

관찰: `4행`

### 엔티티 목록 + 행마다 count 메서드(관계 매핑 없이 저장소 메서드로 나눈 경우) — 된다

```
select e from ProbeEntry e where e.id in :ids
select count(*) from ProbeEntryLike l where l.entryId = :id
```

Hibernate 가 보낸 SQL:

```sql
select pe1_0.id,pe1_0.challenge_id,pe1_0.final_eligible,pe1_0.final_like_count,pe1_0.final_rank,pe1_0.mosaic_key,pe1_0.status,pe1_0.updated_at,pe1_0.user_id from challenge_entries pe1_0 where pe1_0.id in (?,?,?,?);
select count(*) from entry_likes pel1_0 where pel1_0.entry_id=?;
select count(*) from entry_likes pel1_0 where pel1_0.entry_id=?;
select count(*) from entry_likes pel1_0 where pel1_0.entry_id=?;
select count(*) from entry_likes pel1_0 where pel1_0.entry_id=?;
```

관찰: `4행, 좋아요 합 2`

- 보낸 SQL 수: 한 쿼리 1개, 행마다 5개(참여작 4개).

## P41 ILIKE … ESCAPE · CAST(:p AS text) IS NULL(널 매개변수) · = ANY(배열 열) · LATERAL

원본 `PostgresScriptRepository#list#1(부분)`

```sql
SELECT s.id, s.title,
       (SELECT string_agg(c.name,:sep ORDER BY c.sort_order) FROM script_characters c
        WHERE c.id=ANY(ls.my_character_ids)) AS my_character_names
FROM scripts s
LEFT JOIN LATERAL (
    SELECT rs.status,rs.my_character_ids FROM reading_sessions rs
    WHERE rs.script_id=s.id ORDER BY rs.started_at DESC,rs.id DESC LIMIT 1
) ls ON true
WHERE s.user_id=:userId
  AND (CAST(:pattern AS text) IS NULL
       OR s.title ILIKE CAST(:pattern AS text) ESCAPE '\'
       OR EXISTS (SELECT 1 FROM script_characters c
                  WHERE c.script_id=s.id AND c.name ILIKE CAST(:pattern AS text) ESCAPE '\'))
ORDER BY s.updated_at DESC,s.id DESC
```

### HQL ilike … escape, :pattern is null(널), array_contains(배열 열, 값) — 된다

```
select s.id, s.title,
       (select listagg(c.name, :sep) within group (order by c.sortOrder) from ProbeScriptCharacter c
        where array_contains(ls.myCharacterIds, c.id)) as myCharacterNames
from ProbeScript s
left join lateral (
    select rs.status as status, rs.myCharacterIds as myCharacterIds from ProbeReadingSession rs
    where rs.scriptId = s.id order by rs.startedAt desc, rs.id desc limit 1
) ls on true
where s.userId = :userId
  and (:pattern is null
       or s.title ilike :pattern escape '\'
       or exists (select 1 from ProbeScriptCharacter c where c.scriptId = s.id and c.name ilike :pattern escape '\'))
order by s.updatedAt desc, s.id desc
```

Hibernate 가 보낸 SQL:

```sql
select ps1_0.id,ps1_0.title,(select string_agg(psc1_0.name,cast(? as varchar) order by psc1_0.sort_order) from script_characters psc1_0 where ls1_0.c1@>array[psc1_0.id]) from scripts ps1_0 left join lateral (select prs1_0.status,prs1_0.my_character_ids from reading_sessions prs1_0 where prs1_0.script_id=ps1_0.id order by prs1_0.started_at desc,prs1_0.id desc fetch first 1 rows only) ls1_0(c0,c1) on true where ps1_0.user_id=? and (? is null or ps1_0.title ilike ? escape '\' or exists(select 1 from script_characters psc2_0 where psc2_0.script_id=ps1_0.id and psc2_0.name ilike ? escape '\')) order by ps1_0.updated_at desc,ps1_0.id desc;
```

관찰: `[[00000000-0000-0000-0000-0000000000f0, 덴마크 왕자, 햄릿], [3d83a282-8faf-44fa-9ccd-a2b7b97da538, 갈매기, null]]`

- 결과 같음(검색어 없음(널)): 예 — 네이티브 [[00000000-0000-0000-0000-0000000000f0, 덴마크 왕자, 햄릿], [3d83a282-8faf-44fa-9ccd-a2b7b97da538, 갈매기, null]] / HQL [[00000000-0000-0000-0000-0000000000f0, 덴마크 왕자, 햄릿], [3d83a282-8faf-44fa-9ccd-a2b7b97da538, 갈매기, null]]

- 결과 같음(배역 이름으로 찾음): 예 — 네이티브 [[00000000-0000-0000-0000-0000000000f0, 덴마크 왕자, 햄릿]] / HQL [[00000000-0000-0000-0000-0000000000f0, 덴마크 왕자, 햄릿]]

- 결과 같음(없음): 예 — 네이티브 [] / HQL []

## P42 (array_agg(… ORDER BY …))[1] · bool_or · count(DISTINCT)

원본 `PostgresNotificationRepository#inbox#1(같은 연산)`

```sql
SELECT c.document_id, count(DISTINCT c.action) AS kinds,
       count(*) FILTER (WHERE c.action='granted') AS granted,
       (array_agg(c.action ORDER BY c.occurred_at DESC,c.id DESC))[1] AS latest,
       bool_or(c.action='revoked') AS ever_revoked
FROM user_consents c WHERE c.user_id=:userId GROUP BY c.document_id ORDER BY c.document_id
```

### HQL array_agg … within group 의 첫 원소(array_get), any(조건) — 안 된다

```
select c.documentId, count(distinct c.action),
       count(*) filter (where c.action = 'granted'),
       array_get(array_agg(c.action) within group (order by c.occurredAt desc, c.id desc), 1),
       any(c.action = 'revoked')
from ProbeUserConsent c where c.userId = :userId group by c.documentId order by c.documentId
```

Hibernate 가 보낸 SQL:

```sql
select puc1_0.document_id,count(distinct puc1_0.action),count(*) filter (where puc1_0.action='granted'),array_agg(puc1_0.action order by puc1_0.occurred_at desc,puc1_0.id desc)[1],bool_or(puc1_0.action='revoked') from user_consents puc1_0 where puc1_0.user_id=? group by puc1_0.document_id order by puc1_0.document_id;
```

오류: `SQLGrammarException: JDBC exception executing SQL [ERROR: syntax error at or near "[" ← PSQLException: ERROR: syntax error at or near "["`

### 다시 쓰기: 첫 원소를 상관 서브쿼리(order by … limit 1)로 — 된다

```
select c.documentId, count(distinct c.action),
       count(*) filter (where c.action = 'granted'),
       (select c2.action from ProbeUserConsent c2 where c2.userId = c.userId and c2.documentId = c.documentId
        order by c2.occurredAt desc, c2.id desc limit 1),
       any(c.action = 'revoked')
from ProbeUserConsent c where c.userId = :userId group by c.userId, c.documentId order by c.documentId
```

Hibernate 가 보낸 SQL:

```sql
select puc1_0.document_id,count(distinct puc1_0.action),count(*) filter (where puc1_0.action='granted'),(select puc2_0.action from user_consents puc2_0 where puc2_0.user_id=puc1_0.user_id and puc2_0.document_id=puc1_0.document_id order by puc2_0.occurred_at desc,puc2_0.id desc fetch first 1 rows only),bool_or(puc1_0.action='revoked') from user_consents puc1_0 where puc1_0.user_id=? group by puc1_0.user_id,puc1_0.document_id order by puc1_0.document_id;
```

관찰: `[[00000000-0000-0000-0000-0000000000d1, 2, 1, revoked, true], [00000000-0000-0000-0000-0000000000d2, 1, 1, granted, false], [00000000-0000-0000-0000-0000000000d3, 1, 1, granted, false]]`

- Hibernate 가 array_get(array_agg(…), 1) 을 괄호 없이 'array_agg(…)[1]' 로 내서 PostgreSQL 이 문법 오류로 거절한다.

- 결과 같음(U1 문서 셋): 예 — 네이티브 [[00000000-0000-0000-0000-0000000000d1, 2, 1, revoked, true], [00000000-0000-0000-0000-0000000000d2, 1, 1, granted, false], [00000000-0000-0000-0000-0000000000d3, 1, 1, granted, false]] / HQL [[00000000-0000-0000-0000-0000000000d1, 2, 1, revoked, true], [00000000-0000-0000-0000-0000000000d2, 1, 1, granted, false], [00000000-0000-0000-0000-0000000000d3, 1, 1, granted, false]]

## P43 빈 목록: NOT (id = ANY(빈 배열)) · 배열 매개변수 INSERT(CAST(:x AS uuid[]))

원본 `PostgresCommunityRepository#replaceImages#1 · PostgresEntryRepository#byLikes#2`

```sql
WITH removed AS (
    DELETE FROM community_post_images
    WHERE post_id = :postId AND NOT (id = ANY (CAST(:keep AS uuid[])))
    RETURNING object_key
)
SELECT object_key AS object_key FROM removed
```

### HQL not in :keep 에 빈 List — 된다

```
delete from ProbePostImage i where i.postId = :postId and i.id not in :keep
```

Hibernate 가 보낸 SQL:

```sql
delete from community_post_images ppi1_0 where ppi1_0.post_id=? and 1=1;
```

관찰: `2`

### HQL not array_contains(:keep, id) 에 빈 배열 — 된다

```
delete from ProbePostImage i where i.postId = :postId and not array_contains(:keep, i.id)
```

Hibernate 가 보낸 SQL:

```sql
delete from community_post_images ppi1_0 where ppi1_0.post_id=? and not(?@>array[ppi1_0.id]);
```

관찰: `2`

### HQL insert … values 에 UUID[]·Integer[] 매개변수 — 된다

```
insert into ProbeRankingSnapshot(id, challengeId, viewerId, basis, entryIds, ranks, createdAt)
values (:id, :challenge, :viewer, :basis, :entries, :ranks, :now)
```

Hibernate 가 보낸 SQL:

```sql
insert into entry_ranking_snapshots as prs1_0(id,challenge_id,viewer_id,basis,entry_ids,ranks,created_at) values (?,?,?,?,?,?,?);
```

관찰: `1`

- 빈 목록으로 지운 행 수: 원본 2, HQL not in 빈 List 2, HQL not array_contains 빈 배열 2.

## P44 jsonb_typeof·jsonb_array_length·jsonb_agg(jsonb_build_object(…) ORDER BY …)

원본 `PostgresLegacyPracticeReader#find#1 · PostgresPracticeDataMigration#applyTranscripts#1`

```sql
SELECT jsonb_typeof(line_results) AS kind, jsonb_array_length(line_results) AS length
FROM reading_sessions WHERE id=:id
```

### 등록 안 된 jsonb_* 함수를 이름으로 부르고 cast — 된다

```
select cast(jsonb_typeof(s.lineResults) as String), cast(jsonb_array_length(s.lineResults) as Integer) from ProbeReadingSession s where s.id = :id
```

Hibernate 가 보낸 SQL:

```sql
select cast(jsonb_typeof(prs1_0.line_results) as varchar),cast(jsonb_array_length(prs1_0.line_results) as integer) from reading_sessions prs1_0 where prs1_0.id=?;
```

관찰: `[[array, 2]]`

### HQL json_arrayagg(json_object(…) order by …)(앱 설정 그대로) — 안 된다

```
select cast(json_arrayagg(json_object('ord', l.ordinal, 'text', l.text) order by l.ordinal) as String)
from ProbeScriptLineText l where l.scriptId = :id
```

오류: `IllegalArgumentException: org.hibernate.query.SemanticException: Can't use function 'json_arrayagg', because tech preview JSON functions are not enabled. To enable, set the 'hibernate.query.hql.json_functions_enabled' setting to 'true'. [select cast(json_arrayagg(json_object('ord', l.ordinal, 'text', l.text) order by l.ordinal) as String) ← SemanticException: Can't use function 'json_arrayagg', because tech preview JSON functions are not enabled. To enable, set the 'hibernate.query.hql.json_functions_enabled' setting to 'true'. [select cast(json_arrayagg(json_object('ord', l.ordinal, 'text', l.text) order by l.ordinal) as String)`

### HQL json_arrayagg(json_object(…) order by …) [json_functions_enabled=true] — 된다

```
select cast(json_arrayagg(json_object('ord', l.ordinal, 'text', l.text) order by l.ordinal) as String)
from ProbeScriptLineText l where l.scriptId = :id
```

Hibernate 가 보낸 SQL:

```sql
select cast(json_arrayagg(json_object('ord' value pslt1_0.ordinal,'text' value pslt1_0.text) order by pslt1_0.ordinal absent on null returning jsonb) as varchar) from script_lines pslt1_0 where pslt1_0.script_id=?;
```

관찰: `[{"ord": 1, "text": "x"}, {"ord": 2, "text": "y"}]`

- 결과 같음(회차 하나): 예 — 네이티브 [[array, 2]] / HQL [[array, 2]]

- JSON 값으로 견줌: 같음 — 네이티브 [{"ord": 1, "text": "x"}, {"ord": 2, "text": "y"}] / HQL [{"ord": 1, "text": "x"}, {"ord": 2, "text": "y"}]

## P45 JPQL CURRENT_TIMESTAMP 와 now()

원본 `PostgresPortfolioRepository#saveIntro 의 updated_at=now() (표본)`

```sql
UPDATE portfolios SET intro=CAST(:intro AS text),updated_at=now() WHERE user_id=:userId
```

### 세션 TimeZone=UTC 에서 JPQL current_timestamp 를 timestamptz 열에 쓰고 now() 와 견줌 — 된다

```
select set_config('TimeZone', :zone, true)
update … set updatedAt = current_timestamp
```

Hibernate 가 보낸 SQL:

```sql
select set_config('TimeZone',?,true);
update ad_settings pas1_0 set updated_at=localtimestamp where pas1_0.id=1;
SELECT abs(extract(epoch FROM (updated_at - now()))) FROM ad_settings WHERE id=1;
```

관찰: `updated_at 과 now() 의 차이(초)=0.000000`

### 세션 TimeZone=America/New_York 에서 JPQL current_timestamp 를 timestamptz 열에 쓰고 now() 와 견줌 — 된다

```
select set_config('TimeZone', :zone, true)
update … set updatedAt = current_timestamp
```

Hibernate 가 보낸 SQL:

```sql
select set_config('TimeZone',?,true);
update ad_settings pas1_0 set updated_at=localtimestamp where pas1_0.id=1;
SELECT abs(extract(epoch FROM (updated_at - now()))) FROM ad_settings WHERE id=1;
```

관찰: `updated_at 과 now() 의 차이(초)=0.000000`

### 세션 TimeZone=Asia/Seoul 에서 JPQL current_timestamp 를 timestamptz 열에 쓰고 now() 와 견줌 — 된다

```
select set_config('TimeZone', :zone, true)
update … set updatedAt = current_timestamp
```

Hibernate 가 보낸 SQL:

```sql
select set_config('TimeZone',?,true);
update ad_settings pas1_0 set updated_at=localtimestamp where pas1_0.id=1;
SELECT abs(extract(epoch FROM (updated_at - now()))) FROM ad_settings WHERE id=1;
```

관찰: `updated_at 과 now() 의 차이(초)=0.000000`
