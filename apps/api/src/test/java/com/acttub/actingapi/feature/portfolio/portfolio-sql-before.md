# 포트폴리오 저장소가 보낸 SQL

`PortfolioSqlTraceIT` 가 만든다. 단계마다 Hibernate 가 보낸 SQL 과 돌려받은 값. 정리 장부(`PortfolioPhotoCleanup`)가 보낸 SQL 도 그 단계에 함께 잡힌다.

총 SQL 82개

## 돌려받은 값

```
find(빈 포트폴리오) → intro=null credits=[] photos=[] share=Share[enabled=false, slug=null]
saveIntro → ok
addCredit(첫째) → Credit[id=<생성 id>, title=햄릿, role=햄릿, year=2024, kind=play]
addCredit(둘째) → Credit[id=<생성 id>, title=갈매기, role=트레플료프, year=2025, kind=film]
updateCredit(제목만) → Credit[id=<생성 id>, title=햄릿(재공연), role=햄릿, year=2024, kind=play]
updateCredit(없는 id) → null
orderCredits → true
orderCredits(목록이 다름) → false
deleteCredit → true
deleteCredit(두 번째) → false
beginPhoto(시한 지난 올리기를 치움) → true
completePhoto → ok
beginPhoto(상한) → false
beginPhoto → true
completePhoto(둘째) → ok
photo → PendingPhoto[id=00000000-0000-0000-0000-00000000bb01, objectKey=portfolio/p1, mimeType=image/jpeg, sizeBytes=1000, expiresAt=2026-11-24T03:10:00Z, uploaded=true]
orderPhotos → true
deletePhoto → 1
deletePhoto(없음) → null
share(켬) → Share[enabled=true, slug=slug-trace]
share(끔) → Share[enabled=false, slug=slug-trace]
sharedOwner(꺼짐) → null
share(다시 켬) → Share[enabled=true, slug=slug-trace]
sharedOwner → 00000000-0000-0000-0000-00000000aa01
find(채운 포트폴리오) → intro=소개 credits=[햄릿(재공연)/햄릿/2024/play] photos=[portfolio/p1] share=Share[enabled=true, slug=slug-trace]
```

## find(빈 포트폴리오) — SQL 1개

```sql
SELECT intro,share_enabled,share_slug FROM portfolios WHERE user_id=?;
```

## saveIntro — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
UPDATE portfolios SET intro=CAST(? AS text),updated_at=now() WHERE user_id=?;
```

## addCredit(첫째) — SQL 5개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
SELECT count(*) FROM portfolio_credits WHERE user_id=?;
INSERT INTO portfolio_credits(id,user_id,title,role,year,kind,sort_order) SELECT ?,?,?,?,?,?,COALESCE(MAX(sort_order),-1)+1 FROM portfolio_credits WHERE user_id=?;
```

## addCredit(둘째) — SQL 5개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
SELECT count(*) FROM portfolio_credits WHERE user_id=?;
INSERT INTO portfolio_credits(id,user_id,title,role,year,kind,sort_order) SELECT ?,?,?,?,?,?,COALESCE(MAX(sort_order),-1)+1 FROM portfolio_credits WHERE user_id=?;
```

## updateCredit(제목만) — SQL 1개

```sql
WITH changed AS ( UPDATE portfolio_credits SET title=COALESCE(CAST(? AS text),title), role=COALESCE(CAST(? AS text),role), year=COALESCE(CAST(? AS integer),year), kind=COALESCE(CAST(? AS text),kind), updated_at=now() WHERE id=? AND user_id=? RETURNING id,title,role,year,kind ) SELECT id,title,role,year,kind FROM changed;
```

## updateCredit(없는 id) — SQL 1개

```sql
WITH changed AS ( UPDATE portfolio_credits SET title=COALESCE(CAST(? AS text),title), role=COALESCE(CAST(? AS text),role), year=COALESCE(CAST(? AS integer),year), kind=COALESCE(CAST(? AS text),kind), updated_at=now() WHERE id=? AND user_id=? RETURNING id,title,role,year,kind ) SELECT id,title,role,year,kind FROM changed;
```

## orderCredits — SQL 6개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
SELECT id FROM portfolio_credits WHERE user_id=?;
UPDATE portfolio_credits SET sort_order=? WHERE id=? AND user_id=?;
UPDATE portfolio_credits SET sort_order=? WHERE id=? AND user_id=?;
```

## orderCredits(목록이 다름) — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
SELECT id FROM portfolio_credits WHERE user_id=?;
```

## deleteCredit — SQL 1개

```sql
DELETE FROM portfolio_credits WHERE id=? AND user_id=?;
```

## deleteCredit(두 번째) — SQL 1개

```sql
DELETE FROM portfolio_credits WHERE id=? AND user_id=?;
```

## beginPhoto(시한 지난 올리기를 치움) — SQL 7개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
WITH removed AS ( DELETE FROM portfolio_photos WHERE user_id=? AND uploaded_at IS NULL AND expires_at<=? RETURNING object_key ) SELECT object_key FROM removed;
INSERT INTO account_cleanup_operations( id,user_id,kind,payload_encrypted,next_attempt_at,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?);
SELECT count(*) FROM portfolio_photos WHERE user_id=?;
INSERT INTO portfolio_photos(id,user_id,object_key,mime_type,size_bytes,expires_at) VALUES (?,?,?,?,?,?);
```

## completePhoto — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
UPDATE portfolio_photos SET uploaded_at=?, sort_order=(SELECT COALESCE(MAX(sort_order),-1)+1 FROM portfolio_photos WHERE user_id=? AND uploaded_at IS NOT NULL) WHERE id=? AND user_id=? AND uploaded_at IS NULL;
```

## beginPhoto(상한) — SQL 5개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
WITH removed AS ( DELETE FROM portfolio_photos WHERE user_id=? AND uploaded_at IS NULL AND expires_at<=? RETURNING object_key ) SELECT object_key FROM removed;
SELECT count(*) FROM portfolio_photos WHERE user_id=?;
```

## beginPhoto — SQL 6개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
WITH removed AS ( DELETE FROM portfolio_photos WHERE user_id=? AND uploaded_at IS NULL AND expires_at<=? RETURNING object_key ) SELECT object_key FROM removed;
SELECT count(*) FROM portfolio_photos WHERE user_id=?;
INSERT INTO portfolio_photos(id,user_id,object_key,mime_type,size_bytes,expires_at) VALUES (?,?,?,?,?,?);
```

## completePhoto(둘째) — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
UPDATE portfolio_photos SET uploaded_at=?, sort_order=(SELECT COALESCE(MAX(sort_order),-1)+1 FROM portfolio_photos WHERE user_id=? AND uploaded_at IS NOT NULL) WHERE id=? AND user_id=? AND uploaded_at IS NULL;
```

## photo — SQL 1개

```sql
SELECT id,object_key,mime_type,size_bytes,expires_at,uploaded_at IS NOT NULL AS uploaded FROM portfolio_photos WHERE id=? AND user_id=?;
```

## orderPhotos — SQL 6개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
SELECT id FROM portfolio_photos WHERE user_id=? AND uploaded_at IS NOT NULL;
UPDATE portfolio_photos SET sort_order=? WHERE id=? AND user_id=?;
UPDATE portfolio_photos SET sort_order=? WHERE id=? AND user_id=?;
```

## deletePhoto — SQL 2개

```sql
WITH removed AS ( DELETE FROM portfolio_photos WHERE id=? AND user_id=? RETURNING object_key,expires_at,uploaded_at ) SELECT object_key,expires_at,uploaded_at FROM removed;
INSERT INTO account_cleanup_operations( id,user_id,kind,payload_encrypted,next_attempt_at,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?);
```

## deletePhoto(없음) — SQL 1개

```sql
WITH removed AS ( DELETE FROM portfolio_photos WHERE id=? AND user_id=? RETURNING object_key,expires_at,uploaded_at ) SELECT object_key,expires_at,uploaded_at FROM removed;
```

## share(켬) — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
WITH changed AS ( UPDATE portfolios SET share_slug=COALESCE(share_slug,CASE WHEN ? THEN ? END), share_enabled=?, updated_at=now() WHERE user_id=? RETURNING share_enabled,share_slug ) SELECT share_enabled,share_slug FROM changed;
```

## share(끔) — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
WITH changed AS ( UPDATE portfolios SET share_slug=COALESCE(share_slug,CASE WHEN ? THEN ? END), share_enabled=?, updated_at=now() WHERE user_id=? RETURNING share_enabled,share_slug ) SELECT share_enabled,share_slug FROM changed;
```

## sharedOwner(꺼짐) — SQL 1개

```sql
SELECT user_id FROM portfolios WHERE share_slug=? AND share_enabled;
```

## share(다시 켬) — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
INSERT INTO portfolios(user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING;
SELECT user_id FROM portfolios WHERE user_id=? FOR UPDATE;
WITH changed AS ( UPDATE portfolios SET share_slug=COALESCE(share_slug,CASE WHEN ? THEN ? END), share_enabled=?, updated_at=now() WHERE user_id=? RETURNING share_enabled,share_slug ) SELECT share_enabled,share_slug FROM changed;
```

## sharedOwner — SQL 1개

```sql
SELECT user_id FROM portfolios WHERE share_slug=? AND share_enabled;
```

## find(채운 포트폴리오) — SQL 3개

```sql
SELECT intro,share_enabled,share_slug FROM portfolios WHERE user_id=?;
SELECT id,title,role,year,kind FROM portfolio_credits WHERE user_id=? ORDER BY sort_order,created_at,id;
SELECT id,object_key FROM portfolio_photos WHERE user_id=? AND uploaded_at IS NOT NULL ORDER BY sort_order,uploaded_at,id;
```
