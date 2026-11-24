# 포트폴리오 저장소가 보낸 SQL

`PortfolioSqlTraceIT` 가 만든다. 단계마다 Hibernate 가 보낸 SQL 과 돌려받은 값. 정리 장부(`PortfolioPhotoCleanup`)가 보낸 SQL 도 그 단계에 함께 잡힌다.

총 SQL 88개

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
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=?;
```

## saveIntro — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
update portfolios pe1_0 set intro=?,updated_at=localtimestamp where pe1_0.user_id=?;
```

## addCredit(첫째) — SQL 5개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
select count(pce1_0.id) from portfolio_credits pce1_0 where pce1_0.user_id=?;
insert into portfolio_credits as pce1_0(id,user_id,title,role,year,kind,sort_order) select ?,?,?,?,?,?,(coalesce(max(pce2_0.sort_order),-1)+1) from portfolio_credits pce2_0 where pce2_0.user_id=?;
```

## addCredit(둘째) — SQL 5개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
select count(pce1_0.id) from portfolio_credits pce1_0 where pce1_0.user_id=?;
insert into portfolio_credits as pce1_0(id,user_id,title,role,year,kind,sort_order) select ?,?,?,?,?,?,(coalesce(max(pce2_0.sort_order),-1)+1) from portfolio_credits pce2_0 where pce2_0.user_id=?;
```

## updateCredit(제목만) — SQL 2개

```sql
update portfolio_credits pce1_0 set title=coalesce(?,pce1_0.title),role=coalesce(?,pce1_0.role),year=coalesce(?,pce1_0.year),kind=coalesce(?,pce1_0.kind),updated_at=localtimestamp where pce1_0.id=? and pce1_0.user_id=?;
select pce1_0.id,pce1_0.created_at,pce1_0.kind,pce1_0.role,pce1_0.sort_order,pce1_0.title,pce1_0.updated_at,pce1_0.user_id,pce1_0.year from portfolio_credits pce1_0 where pce1_0.id=? and pce1_0.user_id=?;
```

## updateCredit(없는 id) — SQL 1개

```sql
update portfolio_credits pce1_0 set title=coalesce(?,pce1_0.title),role=coalesce(?,pce1_0.role),year=coalesce(?,pce1_0.year),kind=coalesce(?,pce1_0.kind),updated_at=localtimestamp where pce1_0.id=? and pce1_0.user_id=?;
```

## orderCredits — SQL 6개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
select pce1_0.id,pce1_0.created_at,pce1_0.kind,pce1_0.role,pce1_0.sort_order,pce1_0.title,pce1_0.updated_at,pce1_0.user_id,pce1_0.year from portfolio_credits pce1_0 where pce1_0.user_id=?;
update portfolio_credits pce1_0 set sort_order=? where pce1_0.id=? and pce1_0.user_id=?;
update portfolio_credits pce1_0 set sort_order=? where pce1_0.id=? and pce1_0.user_id=?;
```

## orderCredits(목록이 다름) — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
select pce1_0.id,pce1_0.created_at,pce1_0.kind,pce1_0.role,pce1_0.sort_order,pce1_0.title,pce1_0.updated_at,pce1_0.user_id,pce1_0.year from portfolio_credits pce1_0 where pce1_0.user_id=?;
```

## deleteCredit — SQL 1개

```sql
delete from portfolio_credits pce1_0 where pce1_0.id=? and pce1_0.user_id=?;
```

## deleteCredit(두 번째) — SQL 1개

```sql
delete from portfolio_credits pce1_0 where pce1_0.id=? and pce1_0.user_id=?;
```

## beginPhoto(시한 지난 올리기를 치움) — SQL 8개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
select ppe1_0.id,ppe1_0.created_at,ppe1_0.expires_at,ppe1_0.mime_type,ppe1_0.object_key,ppe1_0.size_bytes,ppe1_0.sort_order,ppe1_0.uploaded_at,ppe1_0.user_id from portfolio_photos ppe1_0 where ppe1_0.user_id=? and ppe1_0.uploaded_at is null and ppe1_0.expires_at<=? for no key update of ppe1_0;
delete from portfolio_photos ppe1_0 where ppe1_0.id in (?);
INSERT INTO account_cleanup_operations( id,user_id,kind,payload_encrypted,next_attempt_at,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?);
select count(ppe1_0.id) from portfolio_photos ppe1_0 where ppe1_0.user_id=?;
insert into portfolio_photos (expires_at,mime_type,object_key,size_bytes,sort_order,uploaded_at,user_id,id) values (?,?,?,?,?,?,?,?);
```

## completePhoto — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
update portfolio_photos ppe1_0 set uploaded_at=?,sort_order=(select (coalesce(max(ppe2_0.sort_order),-1)+1) from portfolio_photos ppe2_0 where ppe2_0.user_id=? and ppe2_0.uploaded_at is not null) where ppe1_0.id=? and ppe1_0.user_id=? and ppe1_0.uploaded_at is null;
```

## beginPhoto(상한) — SQL 5개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
select ppe1_0.id,ppe1_0.created_at,ppe1_0.expires_at,ppe1_0.mime_type,ppe1_0.object_key,ppe1_0.size_bytes,ppe1_0.sort_order,ppe1_0.uploaded_at,ppe1_0.user_id from portfolio_photos ppe1_0 where ppe1_0.user_id=? and ppe1_0.uploaded_at is null and ppe1_0.expires_at<=? for no key update of ppe1_0;
select count(ppe1_0.id) from portfolio_photos ppe1_0 where ppe1_0.user_id=?;
```

## beginPhoto — SQL 6개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
select ppe1_0.id,ppe1_0.created_at,ppe1_0.expires_at,ppe1_0.mime_type,ppe1_0.object_key,ppe1_0.size_bytes,ppe1_0.sort_order,ppe1_0.uploaded_at,ppe1_0.user_id from portfolio_photos ppe1_0 where ppe1_0.user_id=? and ppe1_0.uploaded_at is null and ppe1_0.expires_at<=? for no key update of ppe1_0;
select count(ppe1_0.id) from portfolio_photos ppe1_0 where ppe1_0.user_id=?;
insert into portfolio_photos (expires_at,mime_type,object_key,size_bytes,sort_order,uploaded_at,user_id,id) values (?,?,?,?,?,?,?,?);
```

## completePhoto(둘째) — SQL 4개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
update portfolio_photos ppe1_0 set uploaded_at=?,sort_order=(select (coalesce(max(ppe2_0.sort_order),-1)+1) from portfolio_photos ppe2_0 where ppe2_0.user_id=? and ppe2_0.uploaded_at is not null) where ppe1_0.id=? and ppe1_0.user_id=? and ppe1_0.uploaded_at is null;
```

## photo — SQL 1개

```sql
select ppe1_0.id,ppe1_0.created_at,ppe1_0.expires_at,ppe1_0.mime_type,ppe1_0.object_key,ppe1_0.size_bytes,ppe1_0.sort_order,ppe1_0.uploaded_at,ppe1_0.user_id from portfolio_photos ppe1_0 where ppe1_0.id=? and ppe1_0.user_id=?;
```

## orderPhotos — SQL 6개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
select ppe1_0.id,ppe1_0.created_at,ppe1_0.expires_at,ppe1_0.mime_type,ppe1_0.object_key,ppe1_0.size_bytes,ppe1_0.sort_order,ppe1_0.uploaded_at,ppe1_0.user_id from portfolio_photos ppe1_0 where ppe1_0.user_id=? and ppe1_0.uploaded_at is not null;
update portfolio_photos ppe1_0 set sort_order=? where ppe1_0.id=? and ppe1_0.user_id=?;
update portfolio_photos ppe1_0 set sort_order=? where ppe1_0.id=? and ppe1_0.user_id=?;
```

## deletePhoto — SQL 3개

```sql
select ppe1_0.id,ppe1_0.created_at,ppe1_0.expires_at,ppe1_0.mime_type,ppe1_0.object_key,ppe1_0.size_bytes,ppe1_0.sort_order,ppe1_0.uploaded_at,ppe1_0.user_id from portfolio_photos ppe1_0 where ppe1_0.id=? and ppe1_0.user_id=? for no key update of ppe1_0;
delete from portfolio_photos ppe1_0 where ppe1_0.id in (?);
INSERT INTO account_cleanup_operations( id,user_id,kind,payload_encrypted,next_attempt_at,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?);
```

## deletePhoto(없음) — SQL 1개

```sql
select ppe1_0.id,ppe1_0.created_at,ppe1_0.expires_at,ppe1_0.mime_type,ppe1_0.object_key,ppe1_0.size_bytes,ppe1_0.sort_order,ppe1_0.uploaded_at,ppe1_0.user_id from portfolio_photos ppe1_0 where ppe1_0.id=? and ppe1_0.user_id=? for no key update of ppe1_0;
```

## share(켬) — SQL 5개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
update portfolios pe1_0 set share_slug=coalesce(pe1_0.share_slug,case when ?=true then ? end),share_enabled=?,updated_at=localtimestamp where pe1_0.user_id=?;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=?;
```

## share(끔) — SQL 5개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
update portfolios pe1_0 set share_slug=coalesce(pe1_0.share_slug,case when ?=true then ? end),share_enabled=?,updated_at=localtimestamp where pe1_0.user_id=?;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=?;
```

## sharedOwner(꺼짐) — SQL 1개

```sql
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.share_slug=? and pe1_0.share_enabled=true;
```

## share(다시 켬) — SQL 5개

```sql
SELECT id FROM users WHERE id=? AND status='active' FOR UPDATE;
insert into portfolios as pe1_0(user_id) values (?) on conflict(user_id) do nothing;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=? for no key update of pe1_0;
update portfolios pe1_0 set share_slug=coalesce(pe1_0.share_slug,case when ?=true then ? end),share_enabled=?,updated_at=localtimestamp where pe1_0.user_id=?;
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=?;
```

## sharedOwner — SQL 1개

```sql
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.share_slug=? and pe1_0.share_enabled=true;
```

## find(채운 포트폴리오) — SQL 3개

```sql
select pe1_0.user_id,pe1_0.created_at,pe1_0.intro,pe1_0.share_enabled,pe1_0.share_slug,pe1_0.updated_at from portfolios pe1_0 where pe1_0.user_id=?;
select pce1_0.id,pce1_0.created_at,pce1_0.kind,pce1_0.role,pce1_0.sort_order,pce1_0.title,pce1_0.updated_at,pce1_0.user_id,pce1_0.year from portfolio_credits pce1_0 where pce1_0.user_id=? order by pce1_0.sort_order,pce1_0.created_at,pce1_0.id;
select ppe1_0.id,ppe1_0.created_at,ppe1_0.expires_at,ppe1_0.mime_type,ppe1_0.object_key,ppe1_0.size_bytes,ppe1_0.sort_order,ppe1_0.uploaded_at,ppe1_0.user_id from portfolio_photos ppe1_0 where ppe1_0.user_id=? and ppe1_0.uploaded_at is not null order by ppe1_0.sort_order,ppe1_0.uploaded_at,ppe1_0.id;
```
