# 보관 동의 철회 처리 절차

탈퇴한 사람이 "탈퇴 후 영상·녹음 보관·활용" 동의를 거두겠다고 요청했을 때 개발자가 DB와 저장소에서 직접
처리하는 절차다. 앱 안에 철회 화면은 없고 운영 도구도 만들지 않는다 — 요청이 드물기 때문이다
([01-account.md](../requirements/01-account.md) account.withdraw, [ADR-029](../ADR.md)).

끝났다고 말할 수 있는 조건은 셋이다: **본인 확인을 했고, 그 계정의 영상 객체가 저장소에 없고, 동의 기록의
마지막 줄이 `revoked` 다.**

- 창구는 개인정보 처리방침의 연락처다. 요청은 그리로 들어온다.
- 대상은 **탈퇴한 지 3년이 안 된 회원 계정**뿐이다. 3년이 지나면 매일 도는 일이 해시 행과 영상을 이미
  파기했다(`users.retention_purged_at` 이 차 있다). 게스트는 선택 문서를 묻지 않으므로 대상이 아니다.
- 서버가 맡아 둔 **녹음은 지금 없다**(리딩의 녹음은 기기 안에 있다). 녹음이 서버에 붙으면 3단계에 그 객체를
  더한다.
- 이 문서에는 비밀값을 적지 않는다. 명령은 환경변수의 **이름**만 쓴다. 제공자 ID·해시·이메일을 터미널 밖
  (채팅, 이슈, 이 문서)에 옮겨 적지 않는다.

명령은 홈서버의 환경 디렉터리(`/svc/acttub/<env>/`)에서 실행한다([DEPLOY-HOME.md](DEPLOY-HOME.md)). 아래에서
`dc` 는 다음을 줄인 것이다.

```sh
alias dc='docker compose --env-file .env --env-file release.env'
alias db='dc exec -T db sh -c '\''psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"'\'' psql'
```

## 0. 요청을 받으면

요청자에게 **옛 계정에서 쓰던 것과 같은 제공자 계정으로 앱에 다시 로그인(가입)해 달라**고 하고, 그 새 계정의
이메일이나 가입 시각처럼 새 계정을 고를 단서를 받는다. 본인 확인의 근거는 "옛 계정과 **같은 제공자 계정**을
지금 쥐고 있다"는 것 하나다. 옛 계정에는 이메일도 이름도 남아 있지 않다.

## 1. 새 계정의 신원을 읽는다

```sql
-- 단서(이메일)로 요청자의 새 계정을 고른다. 활성 계정이고 provider_uid 가 있어야 한다.
SELECT users.id AS new_user_id, users.created_at, identities.provider, identities.provider_uid
FROM users
JOIN user_identities AS identities ON identities.user_id = users.id
WHERE users.status = 'active'
  AND users.email = :'requester_email'
  AND identities.provider <> 'guest';
```

```sh
db -v requester_email='<요청자가 알려 준 이메일>' -f - < step1.sql
```

제공자(`provider`)와 제공자 ID(`provider_uid`)를 얻는다. 신원이 둘 이상이면 요청자가 말한 제공자의 것을 쓴다.
이메일이 없는 신원(카카오에서 이메일 제공을 거절한 경우)은 가입 시각으로 좁힌 뒤 요청자에게 확인한다.

## 2. 옛 계정을 해시로 찾는다 — 본인 확인

탈퇴는 신원의 제공자 ID 를 지우고 **HMAC 해시만** 남긴다(`user_identities.uid_hash`). 저장된 값은 어느 키로
만들었는지를 접두사로 말한다: `k1:` 은 전용 키(`ACCOUNT_IDENTITY_HASH_KEY`), `d1:` 은 `JWT_SECRET` 에서 파생한
키다. 전용 키를 나중에 넣었으면 옛 계정은 `d1:`, 그 뒤의 계정은 `k1:` 이라 **두 판 모두로 계산해 대조한다.**

계산은 서버와 같은 식이다(`platform/security/AccountSecrets#identityHashCandidates`, 같은 값임을
`AccountSecretsTest` 가 고정한다).

```
키   = HMAC-SHA256( 비밀값의 UTF-8 바이트, "acttub/identity-hash/v1" )
해시 = <키 판> + ":" + hex( HMAC-SHA256( 키, provider + "\n" + provider_uid ) )
```

비밀값은 api 컨테이너의 환경에 이미 있으므로 **그 안에서** 계산한다. 터미널에 비밀값을 치거나 붙여 넣지
않는다.

```sh
dc exec -T -e PROVIDER='<1단계의 provider>' -e PROVIDER_UID='<1단계의 provider_uid>' api sh -s <<'SH'
set -eu
purpose='acttub/identity-hash/v1'
hex() { od -An -tx1 | tr -d ' \n'; }
derive() { printf '%s' "$purpose" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$(printf '%s' "$1" | hex)" -binary | hex; }
candidate() { printf '%s:' "$1"; printf '%s\n%s' "$PROVIDER" "$PROVIDER_UID" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$2" -binary | hex; echo; }
candidate d1 "$(derive "$JWT_SECRET")"
if [ -n "${ACCOUNT_IDENTITY_HASH_KEY:-}" ]; then candidate k1 "$(derive "$ACCOUNT_IDENTITY_HASH_KEY")"; fi
SH
```

`d1:…` 한 줄, 전용 키가 있으면 `k1:…` 한 줄이 나온다. 그 값으로 옛 계정을 찾는다.

```sql
SELECT users.id AS old_user_id, users.deactivated_at, users.retention_purged_at, identities.provider
FROM user_identities AS identities
JOIN users ON users.id = identities.user_id
WHERE identities.provider = :'provider'
  AND identities.uid_hash IN (:'hash_d1', :'hash_k1')   -- k1 이 없으면 같은 값을 두 번 넣는다
  AND users.status = 'deactivated';
```

- **한 행**이면 본인 확인이 끝났다. 그 `old_user_id` 로 다음 단계를 한다. 같은 사람이 가입과 탈퇴를 되풀이했으면
  여러 행이 나올 수 있다 — 전부 같은 제공자 계정의 것이므로 **행마다** 3~5단계를 한다.
- **0행**이면 이 제공자 계정으로 탈퇴한 기록이 없거나 3년이 지나 이미 파기됐다. 다른 제공자로 가입했던 것은
  아닌지 요청자에게 묻는다. 그래도 없으면 대조할 것이 없으므로 **파기하지 않는다.**
- ⚠ **해시가 없는 옛 계정이 있다.** 제공자에서 연결을 끊은 뒤(카카오·네이버의 연결 끊기 알림은 신원을 행째
  지운다) 탈퇴한 회원은 해시 행이 없어 이 방법으로 찾을 수 없다. 이메일이나 기억에 기대 계정을 추측해 파기하지
  않는다 — 남의 영상을 지우게 된다. 개인정보 보호책임자와 다른 확인 수단을 정한 뒤에만 진행하고, 정하지 못하면
  그 영상은 탈퇴 3년 뒤의 파기를 기다린다.

## 3. 영상 객체를 파기한다

```sql
-- 이 계정이 올린 영상의 객체 키. 연습 행은 남기고 객체만 지운다.
SELECT object_key FROM upload_intents WHERE user_id = :'old_user_id' ORDER BY created_at;

-- 보관 동의가 실제로 살아 있었는지도 함께 본다(마지막 결정과 그 문서).
SELECT consents.action, consents.occurred_at, documents.id AS document_id, documents.version
FROM user_consents AS consents
JOIN consent_documents AS documents ON documents.id = consents.document_id
WHERE consents.user_id = :'old_user_id' AND documents.type = 'retention'
ORDER BY consents.occurred_at DESC, consents.id DESC
LIMIT 1;
```

마지막 결정이 `granted` 가 아니면(거절했거나 이미 철회했다) 영상은 탈퇴 때 이미 파기 대상이었다. 그래도 아래
확인은 끝까지 한다 — 지워졌어야 할 객체가 남아 있으면 지운다.

객체는 영상 버킷(`.env` 의 `S3_BUCKET`, 리전 `AWS_REGION`)에 있다. 키마다:

```sh
aws s3api delete-object --bucket "$S3_BUCKET" --key '<object_key>'
```

버킷에 **버전 관리**가 켜져 있으면 위 명령은 삭제 표시만 남긴다. 먼저 확인하고, 켜져 있으면 그 키의 모든
버전을 지운다.

```sh
aws s3api get-bucket-versioning --bucket "$S3_BUCKET"
aws s3api list-object-versions --bucket "$S3_BUCKET" --prefix '<object_key>' \
  --query '{Objects: [Versions,DeleteMarkers][].{Key:Key,VersionId:VersionId}}'
# 위 목록의 VersionId 마다: aws s3api delete-object --bucket … --key … --version-id …
```

정리 장부(`account_cleanup_operations`)에 손으로 행을 넣지 않는다 — payload 가 서버 키로 암호화한 값이라 SQL 로
만들 수 없다. 이미 올라가 있는 이 계정의 `object_delete` 행은 그대로 둔다(같은 키를 다시 지우는 것은 실패가
아니다).

## 4. 철회를 기록한다

동의 기록은 고쳐 쓰지 않고 **덧붙인다.** 마지막으로 결정했던 그 문서 판에 `revoked` 한 줄을 더한다.

```sql
BEGIN;
INSERT INTO user_consents (id, user_id, document_id, action, occurred_at)
VALUES (gen_random_uuid(), :'old_user_id', :'document_id', 'revoked', now());   -- document_id 는 3단계에서 읽은 값
-- 확인한 뒤에 COMMIT. 한 행이 더해졌는지 본다.
SELECT action, occurred_at FROM user_consents
WHERE user_id = :'old_user_id' AND document_id = :'document_id'
ORDER BY occurred_at DESC, id DESC LIMIT 2;
COMMIT;
```

보관 문서에 결정한 기록이 아예 없으면(3단계의 둘째 질의가 0행) 철회로 적을 동의가 없다 — 행을 만들지 않고
5단계의 객체 확인만 한다.

옛 계정의 다른 것은 건드리지 않는다: `users` 행, 해시 행(3년 뒤 매일 도는 일이 지운다), 연습·분석·대화·노트
행, 가명처리해 남긴 프로필. 요청자의 **새 계정**도 건드리지 않는다.

## 5. 확인한다

```sh
# 키마다 404 여야 한다.
aws s3api head-object --bucket "$S3_BUCKET" --key '<object_key>'
```

```sql
-- 마지막 결정이 revoked 다.
SELECT consents.action
FROM user_consents AS consents
JOIN consent_documents AS documents ON documents.id = consents.document_id
WHERE consents.user_id = :'old_user_id' AND documents.type = 'retention'
ORDER BY consents.occurred_at DESC, consents.id DESC
LIMIT 1;
```

둘 다 맞으면 요청자에게 처리했다고 알린다. 처리 기록(요청 받은 날, 처리한 날, 처리한 사람, 옛 계정의
`old_user_id`)은 팀이 정한 곳에 남기되 **제공자 ID·해시·이메일은 적지 않는다.**

## 알아 둘 것

- **DB 백업**에는 철회 전의 동의 기록이 남아 있지만 영상 객체는 백업에 없다(백업은 `pg_dump` 다). 백업으로
  복원했다면 복원 시점 뒤의 철회를 이 절차로 다시 적용한다.
- 영상을 지운 뒤에도 `upload_intents` 행과 그 `object_key` 는 남는다. 탈퇴 3년 뒤의 파기가 같은 키의 삭제를
  한 번 더 시도하고, 없는 객체의 삭제는 성공으로 끝난다.
- 절차를 바꿔야 하면(해시 식, 키 판, 테이블) 서버 코드와 함께 고친다. 식이 어긋나면 `AccountSecretsTest` 의
  "운영 문서의 셸 절차로 계산한 해시와 같은 값이다"가 깨진다.
