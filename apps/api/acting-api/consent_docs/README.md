# 동의 문서 발행 (consent_docs)

앱(모바일·웹) 로그인 시 뜨는 동의 화면은 서버에 **발행된 동의 문서**를 `GET /v2/consents/documents`로 받아 렌더한다.
현재 dev(`dev.acttub.com`)에는 발행된 문서가 0개라 동의가 수집되지 않는다. 아래 문서 3종을 발행해야 동의 화면이 뜬다.

## 문서
| 파일 | type | version | title | required |
| --- | --- | --- | --- | --- |
| `terms_v1.md` | `terms` | `v1` | 이용약관 | ✅ |
| `privacy_v3.md` | `privacy` | `v3` | 개인정보처리방침 | ✅ |
| `ai_analysis_v1.md` | `ai_analysis` | `v1` | AI 분석 동의 | ✅ |

> `ConsentType` enum은 이 3종만 지원(`db/models.py`). 선택 동의(연구/홍보 등)는 enum + 마이그레이션 확장 필요.

## 발행 (서버에서 실행, `acting-api/` 기준)
DB는 `.env`의 `DATABASE_URL`을 사용한다.

```bash
uv run python -m acting_api.consents publish \
  --type terms --version v1 --title "이용약관" --file consent_docs/terms_v1.md --required

uv run python -m acting_api.consents publish \
  --type privacy --version v3 --title "개인정보처리방침" --file consent_docs/privacy_v3.md --required

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
  그 버전에 동의한 기록이 남아 있다. `privacy_v2`(2026-07-29)는 웹 이용 통계(Google Analytics)를
  위탁 현황에 추가한 개정이고, `privacy_v3`(2026-08-15)는 오류 기록(Sentry)을 추가한 개정이다.

  재동의 비용이 크므로 **수탁자가 늘어날 때마다 올리지 않고 묶어서 올린다.** 모니터링을
  더 붙이기로 한 상태라(Grafana·제품 분석 도구), 그 둘은 확정된 뒤 v4로 한 번에 낸다.
