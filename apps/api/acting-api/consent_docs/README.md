# 동의 문서 발행 (consent_docs)

앱(모바일·웹) 로그인 시 뜨는 동의 화면은 서버에 **발행된 동의 문서**를 `GET /v2/consents/documents`로 받아 렌더한다.
현재 dev(`dev.acttub.com`)에는 발행된 문서가 0개라 동의가 수집되지 않는다. 아래 문서 3종을 발행해야 동의 화면이 뜬다.

## 문서
| 파일 | type | version | title | required |
| --- | --- | --- | --- | --- |
| `terms_v1.md` | `terms` | `v1` | 이용약관 | ✅ |
| `privacy_v4.md` | `privacy` | `v4` | 개인정보처리방침 | ✅ |
| `ai_analysis_v1.md` | `ai_analysis` | `v1` | AI 분석 동의 | ✅ |

> `ConsentType` enum은 이 3종만 지원(`db/models.py`). 선택 동의(연구/홍보 등)는 enum + 마이그레이션 확장 필요.

## 발행 (서버에서 실행, `acting-api/` 기준)
DB는 `.env`의 `DATABASE_URL`을 사용한다.

```bash
uv run python -m acting_api.consents publish \
  --type terms --version v1 --title "이용약관" --file consent_docs/terms_v1.md --required

uv run python -m acting_api.consents publish \
  --type privacy --version v4 --title "개인정보처리방침" --file consent_docs/privacy_v4.md --required

uv run python -m acting_api.consents publish \
  --type ai_analysis --version v1 --title "AI 분석 동의" --file consent_docs/ai_analysis_v1.md --required
```

consent 테이블이 없으면 먼저: `uv run alembic upgrade head`

## 검증
```bash
uv run python -m acting_api.consents list          # 3개 뜨는지
curl -s https://dev.acttub.com/v2/consents/documents   # documents 3개
```
그 후 앱에서 소셜 로그인 → 동의 화면에 3종이 필수로 뜨는지 확인.

## ⚠️ 배포 전 필수
- 자리표시자는 **MVP 기본값으로 채움**: 운영자 `Acttub`, 시행일 `2026-07-22`, 문의 `acttub0527@gmail.com`, 개인정보 보호책임자는 운영자로 통합, 기타 수탁자 행 삭제. 정식 법인명·대표자·시행일이 확정되면 값 갱신.
- 본문은 **법률 자문 아닌 실무 초안** — 특히 얼굴/감정 = 민감정보 소지가 있어 배포 전 법률 검토 권장.
- 본문 수정 시 `--version`을 올려(v2 …) 재발행하면 최신본이 노출된다.
  ⚠️ **버전을 올리면 기존 동의자 전원에게 재동의가 뜬다.** 옛 버전 문서 파일은 지우지 않는다 —
  그 버전에 동의한 기록이 남아 있다.

  - `privacy_v2`(2026-07-29) — 웹 이용 통계(Google Analytics) 위탁 추가
  - `privacy_v3`(2026-08-15 시행 예정) — 오류 기록(Sentry) 추가. **시행 전에 v4로 대체됐다.**
    파일은 남겨 둔다: 이 버전으로 발행돼 있던 동안 동의한 기록이 있다.
  - `privacy_v4`(2026-08-11) — v3 내용을 전부 포함하고 이용 행태 분석(Amplitude)과
    **화면 기록(세션 리플레이)** 을 추가한 개정. **현재 발행 대상.**

## v4 발행 절차

⚠️ **배포가 곧 발행이다.** 위 CLI 는 수동 발행용이고, 평소에는 **be 가 기동할 때
`manifest.json` 을 읽어 아직 없는 문서를 자동으로 발행한다**(`app.py` 의 `lifespan` →
`seed_consent_documents`). `manifest.json` 이 v4 를 가리키는 채로 **운영에 be 를 배포하면
그 순간 v4 가 발행되고 기존 동의자 175명 전원에게 동의 화면이 다시 뜬다.**

그래서 순서는 이렇다:

1. **서비스 내 공지를 먼저 띄운다** — 14항이 "개정 사유 및 시행일을 명시하여 공지"를
   약속한다. 시행일은 `2026-08-11`. 바꾸려면 본문 3곳(상단·개정 이력·하단)을 함께 고친다.
2. **운영에 배포한다** — 이 시점에 v4 가 발행되고 재동의가 시작된다.
   dev 는 먼저 배포해서 동의 화면이 정상으로 뜨는지 확인한다.
3. **운영 Environment 변수 `AMPLITUDE_API_KEY_WEB` 주입 후 다시 배포한다** — 이때부터
   수집이 시작된다. dev·운영에 **서로 다른 프로젝트 키**를 넣는다(호스트로 거르지 않아
   같은 키면 통계가 섞인다).

> `EXPECTED_PRIVACY_VERSION`(fe)과 manifest(be)는 나란히 배포돼 순서가 정해져 있지 않다.
> fe 가 먼저 뜨면 v4 를 기대하는데 아직 v3 만 발행된 창이 잠깐 생기고, 그동안은 아무도
> 동의자로 인정되지 않아 계측이 꺼진다. 재동의를 띄우는 개정에서는 어차피 전원이 다시
> 동의하므로 그대로 둔다(`pending-consents.ts` 주석 참고).

> **harness 시드도 같이 올려야 한다.** `tools/contract-harness/contract_harness/config.py` 의
> `SEED_CONSENT_DOCUMENTS` 가 이 manifest 를 미러링한다. 어긋나면 앱이 새 버전을 추가로
> 발행해 시드 유저의 필수 동의가 비고, contract-harness 전 시나리오가 403 으로 죽는다.
> 이제 `test_seed_consent_documents_match_committed_manifest` 가 이 어긋남을 잡는다.

⚠️ **순서가 뒤집히면 안 된다.** 방침이 발행되지 않은 상태에서 키를 먼저 넣으면 고지 없이
이용 기록과 화면 녹화를 제3자에게 넘기게 된다. `deploy.yml` 의 `계측 키가 방침 고지보다
앞서지 않는지` 가드가 이 조합을 배포 시점에 막지만, 가드는 마지막 방어선이지 절차가 아니다.

> Grafana 는 v4 에 넣지 않았다(2026-08-11 결정). 아직 코드에 없어 무엇을 보낼지 정해지지
> 않았고, 기다리면 Amplitude 까지 같이 늦어진다. 실제로 붙이고 **Grafana Cloud 로 사용자
> 식별자가 섞인 로그를 보내게 되면** 그때 v5 로 낸다. 자체 호스팅이거나 서버 지표만 보내면
> 위탁이 아니라 방침을 건드릴 필요가 없다.
