# 동의 문서 발행 (consent-docs)

앱(모바일·웹) 로그인 시 뜨는 동의 화면은 서버에 **발행된 동의 문서**를 `GET /v2/consents/documents`로 받아 렌더한다.

이 디렉토리가 **발행 정본**이다. 같은 자리의 `manifest.json`이 "지금 발행 중인 판"을 가리키고,
백엔드가 기동할 때 그것을 읽어 아직 없는 문서를 DB에 심는다
(`consent/adapter/ConsentDocumentPublisher`). 옛 판 `.md`도 지우지 않고 함께 싣는다 — 그 판에 동의한 기록이 남아 있다.

규칙은 [account.consent](../../../../../../docs/specs/account/consent.md)가 정본이다 — 동의 문서와 고지의 구분, 문서
종류와 필수 여부(「데이터」), 판을 올릴지와 재동의, 말(locale). 이 문서는 파일을 더하고 발행·확인하는 절차만 적는다.

## 파일

- **동의 문서**: `manifest.json`이 가리키는 `.md`. 지금 발행 중인 판과 말은 `manifest.json`이 유일한 목록이다. 파일
  이름은 어디에도 하드코딩돼 있지 않고 `.md` 전부가 jar 에 실린다(`build.gradle.kts` 의 `processResources`).
- **고지**: 개인정보 처리방침 `privacy_policy.md`. DB 행 없이 `GET /v2/consents/notices`가 전문을 내준다
  (`{"notices":[{"type":"privacy_policy","title":"개인정보 처리방침","body":"…"}]}`). 수탁사(위탁) 고지는 이 파일에 있다.
  **이름이 고정이다** — `DeployedConsentNotices`와 배포 가드(`deploy/consent-gate.sh`)가 이 이름을 본다. 이름을 바꾸면
  둘 다 고친다.
- 종류(`type`)를 더하려면 `ConsentType` enum(`platform/schema/ConsentType.java`)과 Flyway 마이그레이션의 CHECK
  (`ck_consent_documents_type`)를 함께 넓힌다(`ValueCheckCatalogIT` 가 대조한다).
- `privacy` 문서의 "프로필 필수 항목" 표는 `ProfileConsentParityTest` 가 프로필 API 의 필수 항목과 대조한다(규칙은
  [account.profile](../../../../../../docs/specs/account/profile.md)).
- ⚠ `privacy_v5`·`retention_v1` 의 본문은 요구사항이 정한 항목을 담은 **초안**이고 법무 확인 전이다. 얼굴/감정은
  민감정보 소지가 있어 법률 검토를 권장한다. 자리표시자는 MVP 기본값으로 채웠다: 운영자 `Acttub`, 시행일
  `2026-07-22`, 문의 `acttub0527@gmail.com`, 개인정보 보호책임자는 운영자로 통합, 기타 수탁자 행 삭제. 정식
  법인명·대표자·시행일이 확정되면 값을 갱신한다.

## 말(locale) (SOMA-544)

같은 판의 번역본이 나란히 선다(`V7__consent_document_locale.sql`). 한국어가 정본이라는 규칙과 번역본이 없을 때의
폴백은 account.consent 가 정한다. 파일 쪽에서 할 일은 셋이다.

- 새 판을 낼 때 **한국어와 번역본을 같은 배포에 함께 올린다.** 한국어만 올리면 영어 사용자에게 한국어 문서가
  나간다. `ConsentManifestLocaleTest` 가 CI 에서 막는다 — 정말 번역하지 않기로 했다면 그 테스트에 그 판을 예외로
  적고 이유를 남긴다.
- `manifest.json` 항목에 `locale` 을 적는다. 빠지면 한국어로 본다.
- 테스트에서 동의를 직접 심을 때는 `WHERE locale = 'ko'` 로 문서 번호를 집는다.

## 발행 — **배포가 곧 발행이다**

🔁 **손으로 발행하는 CLI 는 없다(`SOMA-403` 5단계).** 이관 기간에는 파이썬
`python -m acting_api.consents publish` 를 서버에서 돌렸지만, 그 파이썬은 사라졌다. 지금은
백엔드가 기동할 때 `ConsentDocumentPublisher` 가 `manifest.json` 을 읽어 **아직 없는 판을
자동으로 심는다.**

그래서 새 판을 내는 절차는 이렇다.

1. `.md` 파일을 이 디렉토리에 추가한다 (옛 파일은 **지우지 않는다**). 번역본도 함께 더한다(위 「말」).
2. `manifest.json` 의 해당 항목을 새 파일·새 버전으로 고친다
3. 배포한다 — **그 순간 발행된다.** dev 를 먼저 배포해 동의 화면이 정상으로 뜨는지 확인한다.

판을 올리면 기존 회원에게 동의 화면이 다시 뜬다(account.consent). 그런 판은 배포 전에 **서비스 내 공지를 먼저
띄우고**(처리방침이 "개정 사유 및 시행일을 명시하여 공지"를 약속한다), 본문의 시행일 문구와 법무 검토를 마친다.

- **새 수집**(수탁사 추가, 수집 항목 추가)이 생기면 `privacy_policy.md` 에 고지하고 `privacy`(개인정보 수집·이용
  동의)의 판도 올린다. 이유는 account.consent 에 있고, 웹의 계측이 현재 판의 결정을 따르는 것은 `ConsentEndpointIT`
  가 회원·게스트 둘 다 고정한다.
- **오탈자만 고칠 때는 판을 올리지 않는다.** 같은 판의 `.md`(또는 `title`)를 고쳐 배포하면 기동할 때 DB 의
  제목·본문을 그 자리에서 덮어쓴다. 판을 올릴지는 사람이 판단한다(account.consent).
- `required` 는 같은 판에서 바꾸지 않는다(경고만 남긴다).

### 계측 키와 고지의 순서

계측 키(`AMPLITUDE_API_KEY_WEB`)는 그 수탁사를 고지·동의 문서에 **발행한 뒤에** 넣는다. 순서가 뒤집히면 되돌릴 수
없다 — 고지 없이 이용 기록과 화면 녹화가 수탁사로 넘어간다. 배포 가드 `deploy/consent-gate.sh` 가 키가 있을 때
**처리방침(`privacy_policy.md`)과 manifest 가 가리키는 한국어 `privacy` 문서 둘 다에** 그 수탁사(Amplitude)가
적혀 있는지를 배포 시점에 본다. 가드는 마지막 방어선이지 절차가 아니다. 웹이 계측을 켜는 조건은
[ANALYTICS.md](../../../../../web/ANALYTICS.md) §1(1)이다.

## 검증
```bash
curl -s -H 'X-Acttub-Client: web/0.1.0' https://dev.acttub.com/v2/consents/documents   # documents 4개
```
그 후 앱에서 소셜 로그인 → 동의 화면에 필수 3종과 선택 1종이 뜨는지 확인.

⚠ **기동 실패로 드러나지 않는다.** `ConsentDocumentPublisher` 는 어떤 실패도 기동을 막지
않는다(문서 시딩이 안 됐다고 앱이 안 뜨면 그 편이 더 나쁘다). 대신 실패를 **보고한다** — manifest 가
없거나 형식이 틀리거나 가리키는 파일이 없으면 `FailureReporter` 로 `UNEXPECTED` 가 올라간다
(`ConsentDocumentPublisher.seed`). 그래도 **배포는 초록으로 끝나므로** 위 curl 로 확인한다:
발행이 안 되면 API 가 옛 판을 현재 판으로 돌려주고, 그러면 새 수집이 옛 동의로 켜질 수 있다.
`manifest.json` 의 판과 `/v2/consents/documents` 의 판이 같은지 본다.
