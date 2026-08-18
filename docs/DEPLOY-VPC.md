# VPC 2계층 배포 절차 (front svc + back svc)

CloudFront → front alb → front svc(Next 서버) → back alb → back svc(Spring Boot) → DB
구조로 배포한다. **운영(`acttub.com`)이 쓰는 형태다.** 개발 서버는 같은 프로세스 구성을
EC2 한 대에 올린 축소판이므로([`DEPLOY-DEV.md`](./DEPLOY-DEV.md)) 배포 스크립트와 systemd
유닛을 양쪽이 공유한다.

가장 큰 차이는 **백엔드가 private subnet에 있어 브라우저가 직접 닿지 못한다**는 점이다.
모든 API 호출은 front svc의 Next rewrites 프록시를 통과한다. 덕분에 브라우저 입장에서는
CloudFront 도메인 하나만 보이므로 same-origin이 유지되고 CORS 설정이 필요 없다.

## 1. 저장소 쪽 변경 (완료됨)

- `apps/web/next.config.ts` — 서버 모드에 `output:'standalone'` 추가, 프록시 대상 환경변수를
  `API_ORIGIN`으로 통일(`DEV_API_ORIGIN`은 폴백으로 유지).
- `apps/web/package.json` — `build`가 standalone 산출물을 만든다. (정적 export 모드는
  더 이상 쓰지 않아 걷어냈다.)
- `deploy/systemd/acttub-web.service`·`acttub-api-java.service` — 두 인스턴스용 유닛.
  유닛 이름의 `-java`는 디렉토리가 아니라 유닛을 따른다(`SOMA-403`에서 개명하지 않았다).

## 2. 인스턴스 부트스트랩 (런타임 설치)

새 인스턴스는 비어 있다. 배포 전에 런타임을 깔아야 한다.

**빌드는 전부 로컬에서 하므로 인스턴스에 git·pnpm은 필요 없다.** 산출물과 소스를 S3로
보내고, 인스턴스는 그것을 받아 실행하기만 한다. 저장소를 클론하지 않으니 deploy key도
필요 없다.

### 공통 — aws CLI

S3에서 아티팩트를 받으려면 필요하다. Ubuntu 24.04 기본 이미지에는 없다.

```bash
sudo snap install aws-cli --classic
aws sts get-caller-identity    # Arn에 인스턴스 role 이름이 나오면 정상
```

**인스턴스에서는 `aws configure`를 하지 않는다.** 인스턴스 role이 자격증명을 자동으로
제공하므로, 키를 넣으면 오히려 role을 덮어쓴다. `aws configure`는 업로드하는 로컬 맥에서만
필요하다.

Gateway VPC Endpoint는 S3로 가는 *경로*를 사설망으로 돌릴 뿐, 요청을 대신 만들어주지
않는다. 그래서 Endpoint가 있어도 인스턴스 안에 요청을 보낼 도구가 필요하다.

### front svc — Node만

**배포판 기본 Node로는 안 된다.** 루트 `package.json`이 `engines: node >= 24`를 요구하는데
Ubuntu/AL2023 기본은 18~20이다.

```bash
# nvm이 아니라 NodeSource로 깐다. nvm은 홈 디렉토리에 설치되어
# systemd 유닛의 ExecStart=/usr/bin/node 와 경로가 어긋난다.
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v            # v24.x 확인
sudo mkdir -p /svc/acttub/web && sudo chown ubuntu:ubuntu /svc/acttub/web
```

### back svc — JRE만

**손으로 깔 것이 없다.** `ssm-deploy.sh be-java`가 `java`를 찾지 못하면 그 자리에서
`openjdk-21-jre-headless`를 설치하고 `/svc/acttub/api-java`를 만든다. 배포 아티팩트가
jar 하나뿐이라 인스턴스에 빌드 도구도 소스도 필요 없다.

미리 깔아 두려면 이렇게 한다.

```bash
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-21-jre-headless
java -version      # 21.x 확인

sudo mkdir -p /svc/acttub/api-java
sudo chown -R ubuntu:ubuntu /svc/acttub
```

**패키지로 깐다 — 홈에 두지 않는다.** SSM으로 접속하면 `ssm-user`로 들어오는데 서비스는
`ubuntu`로 돌기 때문에, 홈에 설치한 런타임은 서비스가 찾지 못한다.
`acttub-api-java.service`의 `ExecStart`가 `/usr/bin/java`를 가리키는 이유가 이것이다.

## 3. AWS 준비

### 3-1. SSM Session Manager (bastion 대체)

두 인스턴스 모두 private subnet이라 SSH로 직접 못 붙는다. bastion을 세우는 대신 SSM을 쓴다.

- 각 인스턴스의 **인스턴스 프로파일에 `AmazonSSMManagedInstanceCore` 정책**을 부착
- SSM Agent 실행 확인 (Amazon Linux 2023 / Ubuntu 공식 AMI는 기본 탑재)
- 아웃바운드 443이 NAT로 나가면 됨 — 인바운드 포트는 하나도 열지 않는다
- 로컬: `brew install --cask session-manager-plugin`

접속:

```bash
aws ssm start-session --target i-xxxxxxxx
```

**SSM 콘솔·CLI 접속은 `ssm-user` 계정으로 들어간다.** 서비스는 `ubuntu`로 돌기 때문에,
홈에 뭔가 설치하거나 파일을 만드는 작업은 `sudo su - ubuntu`로 계정을 바꾼 뒤에 한다.
`sudo`가 붙는 시스템 작업(패키지 설치, `mkdir`, `systemctl`)은 어느 계정에서 하든 같다.

파일 전송은 S3를 경유하므로(4장) SSH 키가 필요 없다. 굳이 `ssh`/`rsync`를 쓰고 싶다면
`~/.ssh/config`에 아래를 넣으면 되지만, 인스턴스에 키페어가 등록되어 있어야 한다.

```
Host i-* mi-*
  ProxyCommand sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p"
```

DB에 GUI 툴로 붙을 때만 포트 포워딩을 추가로 쓴다.

```bash
aws ssm start-session --target <back-svc-instance-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<rds-endpoint>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
```

### 3-2. 보안그룹

| 대상 | 인바운드 |
| --- | --- |
| front alb | CloudFront에서 443/80 |
| front svc | front alb SG에서 3000 |
| back alb | front svc SG에서 80 |
| back svc | back alb SG에서 8080 |
| DB | back svc SG에서 5432 |

back svc에 직접 인바운드를 열지 않는다. 브라우저는 back alb를 볼 일이 없다.

### 3-3. 환경변수 파일

`/etc/acttub/api.env` (back svc, 권한 `600`):

```
DATABASE_URL=postgresql://<user>:<pw>@<rds-endpoint>:5432/<db>
JWT_SECRET=<랜덤 문자열>
GEMINI_API_KEY=<키>
S3_BUCKET=<운영 버킷 이름 — acttub-practice-videos-prod>
AWS_REGION=ap-northeast-2
ADMIN_OPS_TOKEN=<운영 대시보드 토큰>
```

S3 자격증명은 back svc의 EC2 instance role에서 AWS SDK 기본 체인으로 받는다. 이 파일에
`AWS_ACCESS_KEY_ID`·`AWS_SECRET_ACCESS_KEY`를 넣으면 환경변수 provider가 role보다 우선하므로
정상 상태에서는 두 값을 두지 않는다.

권한은 운영 role에 붙은 관리형 정책 `acttub-video-s3-access`가 준다(dev는 인라인
`acttub-dev-videos-s3`가 같은 모양으로 자기 버킷만 허용한다).

| 액션 | 리소스 | 쓰는 곳 |
| --- | --- | --- |
| `PutObject` `GetObject` | `<버킷>/*` | presign 업로드·재생, 분석 워커 다운로드 |
| `DeleteObject` | `<버킷>/*` | 만료 upload intent 정리(분석 워커의 sweep) |
| `ListBucket` | `<버킷>` | **없는 객체 `HeadObject`가 403 대신 404를 받게 한다** |

`ListBucket`이 빠지면 S3는 없는 객체에 404가 아니라 403을 준다. 그러면
`AwsS3Storage.head`가 null 대신 예외를 던져(404만 null로 접는다) 업로드 완료 API가
409 `upload_not_found` 대신 500을 낸다 — 권한이 아니라 **동작이 바뀌므로** 빼지 않는다.

**각 role은 자기 버킷만 허용한다.** 이것이 dev·운영 데이터 경계의 실체다. 권한을 넓힐 때도
리소스 범위는 절대 넓히지 않는다.

🔥 **자격증명이 없어도 API는 뜬다 — 배포는 초록으로 끝나고 업로드·재생만 503이 된다.**
기동 시 검증하는 것은 `S3_BUCKET`↔`AWS_REGION`, `AWS_ACCESS_KEY_ID`↔`AWS_SECRET_ACCESS_KEY`가
**짝으로** 설정됐는지뿐이다(`StorageConfiguration.validateStorageEnvironment`). 자격증명 해석은
S3를 실제로 부르는 순간에 일어나고, 실패하면 `NoCredentialsError` → 503 `storage_not_configured`다.

그래서 **role 권한을 손대거나 키를 지운 뒤에는 배포 성공을 근거로 삼지 말고 업로드 경로를
직접 밟아 본다.** 파이썬 시절에는 무자격증명이면 기동 자체가 거부돼 배포가 알려줬지만,
지금은 알려주지 않는다.

🔎 자격증명을 매 호출마다 다시 해석하므로(`AwsS3Storage.resolveCredentials`) IMDS가 일시적으로
막혔다가 회복되면 **재시작 없이 스스로 낫는다.**

access key 방식으로 되돌려야 할 때는 **서버에 보관해 둔 사본을 쓰지 않는다.** 그 키는
운영·개발 버킷을 모두 허용하므로, 서버에 파일로 남겨 두면 instance role로 만든 경계가
무의미해진다. 대신 필요한 순간에 새로 발급한다.

```bash
aws iam create-access-key --user-name acting-api
```

두 값을 `api.env`에 넣고 재시작하면 환경변수 provider가 role보다 우선해 즉시 되돌아간다.
상황이 끝나면 그 임시 키를 반드시 삭제한다.

front svc는 런타임 환경변수가 필요 없다 (아래 4-1 참고 — 웹 설정은 전부 빌드 시점에 고정된다).

### 3-4. S3 운영 버킷 CORS

presigned PUT은 브라우저에서 S3로 직접 나가므로 서비스 도메인을 버킷 CORS에
**추가**해야 한다. **기존 항목은 절대 지우지 않는다** — 지우면 그 오리진의 업로드가 즉시
깨진다.

버킷은 dev와 나눠 쓴다: 운영은 `acttub-practice-videos-prod`, dev는 `-dev`다. 각 EC2의
instance role이 자기 버킷 객체만 허용하므로 `S3_BUCKET`을 반대쪽으로 적으면 자격증명
해석과 `/health`는 성공하는데 실제 PUT/GET만 403이 된다.

```json
{
  "AllowedOrigins": ["https://<cloudfront-domain>"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"]
}
```

### 3-5. CloudFront 캐시 정책 ⚠️

기본 캐시 정책은 `Authorization` 헤더를 오리진으로 전달하지 않는다. 그대로 두면 로그인
직후부터 전 API가 401로 떨어진다.

- `/v2/*`, `/health` → **CachingDisabled** + Origin Request Policy에 `Authorization`,
  `Content-Type`, `X-Request-Id` 포함 (`AllViewer` 관리형 정책이 가장 간단)
- `/_next/static/*` → 캐싱 허용 (콘텐츠 해시가 붙어 안전)
- 기본 동작(`*`) → 캐싱 최소화. Next 서버가 HTML을 만들므로 과한 캐싱은 배포 반영을 늦춘다

### 3-6. ALB 헬스체크

- front alb → front svc: `/` (HTTP 200)
- back alb → back svc: `/health` — DB를 건드리지 않는 핸들러라 헬스체크로 안전하다

## 4. 배포

### 4-1. front svc (Next 서버)

**웹 설정은 전부 빌드 시점에 번들·매니페스트로 고정된다.** 런타임 환경변수로는 바뀌지 않는다.

- `API_ORIGIN` — rewrites는 빌드 시 `routes-manifest.json`으로 직렬화된다
- `NEXT_PUBLIC_*` — 클라이언트 번들에 그대로 새겨진다
- `NEXT_PUBLIC_API_BASE_URL`은 **비워둔다**. 값을 주면 브라우저가 백엔드를 직접 호출하는데,
  back alb는 private이라 전부 실패한다. 비어 있어야 상대 경로로 나가 프록시를 탄다

**빌드는 로컬(맥)에서 하고 산출물만 보낸다.** EC2에는 git도 pnpm도 필요 없다.
아래 과정을 `deploy/upload-web.sh`가 대신하므로 평소에는 이것만 실행하면 된다.

```bash
DEPLOY_BUCKET=<배포 버킷> API_ORIGIN=http://<back-alb-dns> \
  deploy/upload-web.sh
```

빌드 → sharp 제외 → 정적 자산 병합 → 네이티브 바이너리 잔존 검사 → S3 업로드까지
하고, 인스턴스에서 이어서 칠 명령을 출력한다. 아래는 그 스크립트가 무슨 일을 하는지에
대한 설명이다.

**standalone은 정적 자산을 자동으로 포함하지 않는다.** 빌드 직후 `.next/static`은 산출물
안에 없다(확인함). 이 복사를 빠뜨리면 화면이 스타일 없이 뜨거나 JS가 404로 죽는다 —
가장 흔한 실수다.

모노레포라 산출물이 트리 구조를 유지한다. `server.js`는 `apps/web/` 아래, `node_modules`는
그 상위에 놓이므로 **트리 전체를 통째로** 옮겨야 한다.

```
.next/standalone/
  node_modules/
  apps/web/
    server.js
```

### sharp를 제외해야 한다 ⚠️

standalone에는 `sharp`의 **빌드한 플랫폼 전용** 네이티브 바이너리가 딸려온다
(맥에서 빌드하면 `sharp-darwin-arm64.node`). `images.unoptimized`를 켜도 Next의 의존성
트레이싱이 무조건 포함시키므로 설정으로는 뺄 수 없다. 그대로 리눅스로 옮기면 로드에
실패하므로 **전송에서 제외한다.** 이미지 최적화를 쓰지 않아 실제로 로드되지 않는다.

제외하면 산출물에 네이티브 바이너리가 하나도 남지 않아(45M → 27M) 플랫폼 무관해진다.
맥에서 sharp를 뺀 채 기동해 페이지·정적 자산·프록시가 모두 정상 동작함을 확인했다.

`--exclude '*sharp*'`가 핵심이다. `upload-web.sh`는 패키징 후 `*.node` 파일이 남아 있으면
업로드하지 않고 멈춘다 — 리눅스에서 기동 실패로 이어지는 것을 미리 막기 위해서다.

**전송은 S3를 경유한다.** 배포 버킷 하나에 prefix로 나눈다(`fe/`, `be/`). 인스턴스는
S3 Gateway VPC Endpoint로 사설 경로를 통해 받으므로 SSH 키가 필요 없다.

```
s3://<배포 버킷>/
  fe/<타임스탬프>-<git sha>.tar.gz
  fe/latest.tar.gz          # 인스턴스에서 늘 같은 명령으로 받기 위한 별칭
  fe/acttub-web.service
```

디렉토리를 `s3 sync`로 올리지 않고 tar.gz 하나로 묶는 이유는, standalone이 27MB에 파일이
수천 개여서 요청 수가 많고 중간에 끊기면 반만 올라간 상태가 되기 때문이다.

인스턴스 쪽 (SSM으로 접속해서):

```bash
aws s3 cp s3://<배포 버킷>/fe/latest.tar.gz /tmp/web.tar.gz
sudo rm -rf /svc/acttub/web/* && sudo tar xzf /tmp/web.tar.gz -C /svc/acttub/web
sudo chown -R ubuntu:ubuntu /svc/acttub/web
```

인스턴스 IAM role에 해당 prefix 권한이 있어야 한다. 인라인 정책 예(front svc):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<배포 버킷>/fe/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<배포 버킷>",
      "Condition": { "StringLike": { "s3:prefix": "fe/*" } } }
  ]
}
```

back svc는 `fe`를 `be`로 바꾼다. **prefix 조건 때문에 버킷 루트 조회
(`aws s3 ls s3://<배포 버킷>/`)는 정책이 있어도 AccessDenied가 난다** — 의도된 동작이다.
확인은 `aws s3 ls s3://<배포 버킷>/fe/`로 한다.

systemd 유닛의 `WorkingDirectory`가 `/svc/acttub/web/apps/web`인 이유가 이것이다. 한 단계
위에서 실행하면 `server.js`를 못 찾고, `apps/web`만 떼어 옮기면 `node_modules`를 잃는다.

유닛 파일도 같은 버킷에 함께 올라간다.

```bash
aws s3 cp s3://<배포 버킷>/fe/acttub-web.service /tmp/
sudo mv /tmp/acttub-web.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now acttub-web
systemctl status acttub-web --no-pager
```

### 4-2. back svc (Spring Boot)

여기도 git이 필요 없다. **보내는 것은 jar 하나와 유닛 파일뿐**이다 — 소스도 빌드 도구도
인스턴스로 가지 않는다.

```bash
# 로컬에서 (Gradle 빌드 + S3 업로드)
DEPLOY_BUCKET=<배포 버킷> deploy/upload-api-java.sh
```

`.env`는 올라가지 않는다. 운영 값은 `/etc/acttub/api.env`가 담당하고, 배포 스크립트는 그
파일을 건드리지 않는다.

설치는 손으로 하지 않고 `ssm-deploy.sh`가 한다 — JRE가 없으면 깔고, jar와 유닛을 받아
재시작한 뒤 `/health`까지 확인한다.

```bash
DEPLOY_BUCKET=<배포 버킷> deploy/ssm-deploy.sh be-java <back-svc-instance-id>
```

무엇이 실행되는지는 그 스크립트의 `be-java` 분기가 정본이다. 요약하면 이렇다.

```bash
# (인스턴스에서 스크립트가 하는 일)
aws s3 cp s3://<배포 버킷>/be/latest.jar /svc/acttub/api-java/acting-api.jar
aws s3 cp s3://<배포 버킷>/be/acttub-api-java.service /etc/systemd/system/
systemctl daemon-reload && systemctl restart acttub-api-java
```

⚠ **`systemctl is-active`만으로는 판정할 수 없다.** `Type=simple`이라 exec 직후 곧바로
active이므로 크래시루프도 성공으로 읽힌다. 그래서 스크립트가 `NRestarts=0`과
`curl /health` 두 줄을 함께 본다 — **별도 마이그레이션 스텝이 없는 지금, 그 두 줄이 스키마가
코드와 맞는다는 유일한 판정이다.**

⚠ **JVM 기동은 느리다.** Flyway 마이그레이션과 스키마 검증까지 끝나야 리슨을 시작하므로,
배포 대기 시간이 프론트보다 길다(스크립트가 `be-java`에 420초를 준다).

### 4-3. DB 마이그레이션

**손으로 돌리는 절차가 없다.** 스키마 정본이 Flyway 라(`apps/api/CONTRACT.md` §5-5) 마이그레이션은 자바가
기동하며 스스로 적용한다 — 배포가 곧 마이그레이션이다.

마이그레이션이 실패하면 앱이 리슨을 시작하지 못하고 배포 잡이 그 자리에서 실패한다.
그때 볼 것은 인스턴스의 로그다. back svc EC2가 이미 DB에 붙는 머신이라 별도 터널이 필요 없다.

```bash
aws ssm start-session --target <back-svc-instance-id>
sudo journalctl -u acttub-api-java -n 200 --no-pager | grep -i flyway
```

기동할 때마다 Flyway가 결과를 INFO로 찍는다(`application.yml`이 `org.flywaydb: INFO`를 켠다).
적용한 것이 없으면 `Current version of schema "public": 1`, 적용했으면
`Successfully applied N migration(s)`, 실패했으면 그 자리에 예외가 남는다.

**DB를 직접 볼 때만 `psql`이 필요한데, back svc 인스턴스에는 깔려 있지 않다**(RDS를 쓰므로
jar와 JRE 말고는 아무것도 설치하지 않는다). 필요하면 그때 받는다:

```bash
sudo apt-get install -y postgresql-client
DB_URL=$(sudo grep -m1 '^[[:space:]]*DATABASE_URL=' /etc/acttub/api.env | sed -E 's/^[[:space:]]*DATABASE_URL=//; s/^"//; s/"$//')
psql "$DB_URL" -c 'SELECT installed_rank, version, type, success, installed_on FROM flyway_schema_history ORDER BY installed_rank'
```

dev는 인스턴스에 PostgreSQL이 함께 깔려 있어(`bootstrap-dev.sh`) `psql`이 이미 있다.

**DB 는 손댈 것이 없다.** Postgres 는 DDL 이 트랜잭션 안에서 돌므로 실패한 마이그레이션은
**부분 적용도 이력도 남기지 않는다** — 원인을 고쳐 다시 배포하면 그만이고, 이력 행을 지우거나
`flyway repair` 를 돌릴 필요가 없다. 추정이 아니라 실측이다
(`FlywayForwardMigrationTest.aFailedMigrationLeavesNothingBehind` 가 앞 문장은 성공하고 뒤 문장이
깨지는 마이그레이션으로 확인한다).

예외는 마이그레이션이 트랜잭션을 스스로 쪼개는 경우다(`CREATE INDEX CONCURRENTLY` 등). 그런 것을
쓸 거면 **되돌리는 방법을 그 PR 에서 함께 정한다.**

### 4-4. 나쁜 마이그레이션은 배포 실패가 아니라 중단이다

🔥 **3단계에서 폭발 반경이 커졌다.** 예전에는 `migrate` 가 배포보다 **먼저** 도는 별도 스텝이라,
실패해도 옛 프로세스가 그대로 떠 있었다 — 서비스는 살아 있고 배포만 빨간불이었다. 지금은
마이그레이션이 `systemctl restart` **뒤에** 돈다. 옛 프로세스는 이미 죽었고 새 프로세스는 뜨지
못하므로, **나쁜 마이그레이션 = 서비스 중단**이다.

**down 마이그레이션이 없다.** 되돌리는 경로는 하나뿐이다:

1. 문제 마이그레이션을 **되돌리는 새 마이그레이션**(`V<다음>__…`)을 만들어 배포한다.
   이미 적용된 것을 `V1` 처럼 고쳐서 지우려 하면 checksum 이 어긋나 신규 환경이 죽는다.
2. 스키마가 아니라 **코드**가 문제면 이전 jar 로 되돌린다 — `deploy.yml` 을 이전 커밋 SHA 로
   수동 실행한다. **단 그 jar 가 새 스키마에서 뜨는지는 별개다**(`ddl-auto: validate`).

그래서 §6-4 의 "스키마를 먼저 넓히고 코드를 나중에 좁힌다" 가 이제 권고가 아니라 **유일한
안전망**이다. 넓히는 변경만 나가면 옛 jar 도 새 스키마에서 그대로 뜬다.

## 5. 검증 체크리스트

1. `curl http://<back-alb-dns>/health` — back svc 단독 확인 (front svc EC2 안에서 실행)
2. `curl https://<cloudfront-domain>/health` — 프록시 경로가 살아 있는지
3. 브라우저로 접속 → 스타일·JS가 정상인지 (4-1의 static 복사 검증)
4. 구글 로그인 → 401이 나면 CloudFront가 `Authorization`을 떨어뜨리는 것 (3-5)
5. 영상 업로드 → presigned PUT 실패 시 S3 CORS 확인 (3-4)
6. 분석 실행 → NAT를 통한 아웃바운드 LLM 호출 확인

## 6. GitHub Actions 자동 배포 (OIDC)

`.github/workflows/deploy.yml`이 빌드 → S3 업로드 → SSM 설치를 한 번에 한다. Actions
탭에서 수동 실행(`workflow_dispatch`)하며, 환경(`dev`/`prod`)과 대상(`fe`·`be`·`both`)을
고른다.

같은 워크플로가 개발 서버 배포도 담당한다(`dev` 브랜치 push 시 자동). 환경별로 다른
값은 GitHub Environments의 variables가 담당하므로 워크플로 안에는 환경 분기가 없다 —
개발 서버 쪽 절차는 [`DEPLOY-DEV.md`](./DEPLOY-DEV.md)를 본다.

**runner는 인스턴스에 접속하지 않는다.** SSM Run Command로 AWS에 실행을 위임하므로
private subnet이어도 되고, SSH 키나 VPN이 필요 없다.

### 6-1. AWS — OIDC 공급자 등록

IAM → 자격 증명 공급자 → 공급자 추가 → OpenID Connect

- 공급자 URL: `https://token.actions.githubusercontent.com`
- 대상(Audience): `sts.amazonaws.com`

### 6-2. AWS — 배포용 role 생성

신뢰 정책(trust policy). `sub` 조건이 **이 저장소로만** 제한하는 부분이라 빠뜨리면
안 된다 — 없으면 아무 GitHub 저장소나 이 role을 가져다 쓸 수 있다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<계정ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:acttub/acttub-platform:*"
        }
      }
    }
  ]
}
```

권한 정책:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::<배포 버킷>/*"
    },
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ssm:*::document/AWS-RunShellScript",
        "arn:aws:ec2:<리전>:<계정ID>:instance/<fe 인스턴스 ID>",
        "arn:aws:ec2:<리전>:<계정ID>:instance/<be 인스턴스 ID>"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "*"
    }
  ]
}
```

`ssm:SendCommand`의 Resource에 **문서와 인스턴스를 모두** 적어야 한다. 인스턴스만 적으면
document 권한이 없다고 거부된다.

### 6-3. GitHub — 저장소 변수 등록

Settings → Secrets and variables → Actions → **Variables** 탭. 민감한 값이 아니므로
Secrets가 아니라 Variables에 넣는다.

| 이름 | 값 |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<계정ID>:role/<role 이름>` |
| `DEPLOY_BUCKET` | 배포 버킷 이름 |
| `API_ORIGIN` | `http://<back-alb-dns>` |
| `NEXT_PUBLIC_SITE_URL` | CloudFront 도메인 (없으면 비워둔다) |
| `FE_INSTANCE_ID` | front svc 인스턴스 ID |
| `BE_INSTANCE_ID` | back svc 인스턴스 ID |

`API_ORIGIN`을 바꾸면 **반드시 fe를 재배포해야 한다.** 빌드 시점에 굳는 값이라 인스턴스만
재시작해서는 반영되지 않는다.

### 6-4. 마이그레이션은 자바 기동의 일부다

**스키마 정본은 Flyway다**(`apps/api/CONTRACT.md` §5-5, `SOMA-403` 3단계). 배포 아티팩트는 jar 하나뿐이고,
`be-java` 가 그것을 설치해 재시작하면 **앱이 뜨는 도중에** Flyway 가 `db/migration` 의 마이그레이션을
적용한다. 별도 migrate 스텝이 없다.

🔥 **스키마를 바꾸려면 `apps/api/src/main/resources/db/migration/` 에 `V2__` 부터 새 파일을
만든다. `V1__baseline.sql` 은 동결이다** — 고치면 dev·운영은 멀쩡한데 신규 환경만
`checksum mismatch` 로 죽는다(재해복구가 필요한 순간에야 드러난다).

**어긋난 채로 초록이 뜨는 창이 구조적으로 사라졌다.** 마이그레이션이 실패하면 앱이 리슨을
시작하지 못하고, `be-java` 의 health·`NRestarts` 검사가 그 자리에서 배포를 실패로 만든다.
예전에는 마이그레이션이 별도 스텝이라 부분 적용이 성공으로 읽힐 수 있었고, 2026-08-01에 그 창으로
`/v2/community/posts` 가 며칠간 500이었다(`column community_posts.anonymous does not exist`).
`deploy/check-migration.sh` 는 그 창을 사후에 대조하던 장치라 이제 아무도 부르지 않는다.

되돌리기 어려운 성질은 그대로다. 그래서 **순서로 통제한다**:

> 스키마는 먼저 넓히고, 코드는 나중에 좁힌다.
>
> - 컬럼 추가·테이블 추가 → 코드보다 먼저 또는 같이 나가도 안전하다.
> - 컬럼 삭제·이름 변경 → **PR을 둘로 나눈다.** ① 새 컬럼을 쓰도록 코드를 바꿔 배포,
>   ② 다음 릴리스에서 옛 컬럼을 지운다. 한 PR에 합치면 배포 중간 상태에서 깨진다.

마이그레이션이 실패하면 배포 로그에 Flyway 예외가 그대로 남고 `be-java` 잡이 빨개진다
(→ Slack `#배포알림`). **그때 서비스는 이미 내려가 있다** — 4-4가 그 이유와 되돌리는 경로를,
4-3이 로그·이력 확인법을 담는다.

**빈 DB 에서 시작하는 신규 환경·재해복구**에는 baseline 절차가 필요 없다 — Flyway 가 V1 부터
그대로 적용한다. 운영 데이터를 부어야 하는 경우의 순서는 `docs/archive/soma287/M6-findings.md` §3에 실측으로
확인된 것이 있다(마이그레이션 장부 둘을 덤프에서 빼고, 앱이 심는 것과 V1 이 심는 것을 먼저 비운다).

### 6-5. 브랜치가 곧 환경이다

`main`에 머지되면 운영으로 자동 배포된다(`dev`는 dev로). **`main` 머지가 곧 릴리스다.**

이 구조 이전에는 운영 배포가 수동이었고, 그게 최대 위험이었다. `workflow_dispatch`는
**어디에 배포할지(`environment`)와 무엇을 배포할지(ref)를 따로** 받는데, ref는 Actions UI의
"Use workflow from" 드롭다운이 정하고 **기본값이 default branch(`dev`)** 다. 환경만 `prod`로
바꾸고 브랜치를 그대로 두면 운영 서버에 dev 브랜치 코드가 올라갔다. 2026-08-01에 실제로
세 번 그렇게 나갔다.

자동 배포는 이 함정을 원천 제거한다 — 사람이 드롭다운을 고를 일이 없다.

수동 실행은 재배포와 부분 배포(`target=fe|be`)를 위해 남아 있고, 그 경로에는 함정이
그대로 있으므로 `guard` 잡이 계속 막는다. CLI로 실행하면 ref를 명시하게 되어 안전하다.

```bash
gh workflow run deploy.yml --ref main -f environment=prod -f target=both
```

## 7. 아직 남은 것

- 루트 `CLAUDE.md`의 "운영 형태" 서술은 아직 단일 프로세스 방식을 가리킨다. 실제 운영이
  이 구조로 넘어간 뒤에 갱신한다 — 지금 바꾸면 현행 dev/prod 설명이 틀리게 된다.
  (`apps/web/CLAUDE.md`는 빌드 모드가 실제로 둘이 되었으므로 이미 갱신했다.)
