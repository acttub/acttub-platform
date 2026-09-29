# account.portfolio 포트폴리오

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: 0.1.0
- 결정 기록: ADR-030
- 화면: A4 프로필(포트폴리오 편집). 편집 화면과 공개 페이지는 미설계
- 테이블: portfolios, portfolio_credits, portfolio_photos (ERD에 추가), user_profiles

## 기능
배우가 오디션에 낼 포트폴리오를 직접 적어 두고 공유 링크로 보여 준다. 가입 때 받는 프로필 여섯
항목(account.profile)과는 다른 것이다. 항목은 소개글, 경력 여러 개, 사진 여러 장이고, 링크는
배우가 켠 동안만 열린다.

## 의도
배우는 오디션마다 소개 자료를 새로 써서 보낸다. 한 번 적어 두면 링크 하나로 낼 수 있다. 디자인의
프로필 탭이 "배우 정보와 경력을 추가해 주세요"로 이 자리를 잡아 두었다.

## 목적
배우가 링크 하나로 자기 경력과 사진을 보여 주고, 내용을 고치면 링크를 다시 보내지 않아도 최신이
보인다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/portfolio` | 헤더 `Authorization`(게이트 통과 회원) | `Portfolio` 200. 편집 전이면 빈 모양 | 게스트 `member_only` 403 |
| `PUT /v2/portfolio/intro` | `PortfolioIntroRequest`: `intro` | `Portfolio` 200 | 422 배열 |
| `POST /v2/portfolio/credits` | `PortfolioCreditRequest`: `title`·`role`·`year`·`kind` | `PortfolioCredit` 201 | 422 배열, `portfolio_credit_limit_exceeded` 422 |
| `PATCH /v2/portfolio/credits/{credit_id}` | `credit_id`, `PortfolioCreditPatch` | `PortfolioCredit` 200 | `portfolio_credit_not_found` 404, 422 배열 |
| `DELETE /v2/portfolio/credits/{credit_id}` | `credit_id` | 204 | `portfolio_credit_not_found` 404 |
| `PUT /v2/portfolio/credits/order` | `PortfolioOrderRequest`: `ids` | `Portfolio` 200 | `order_mismatch` 422 |
| `POST /v2/portfolio/photos` | `PortfolioPhotoUploadRequest`: `content_type`·`size_bytes` | `PortfolioPhotoUploadResponse` 201 | `upload_too_large` 413, `unsupported_media_type` 415, `portfolio_photo_limit_exceeded` 422 |
| `POST /v2/portfolio/photos/{photo_id}/complete` | `photo_id` | `Portfolio` 200. 멱등 | `portfolio_photo_not_found` 404, `upload_intent_expired`·`upload_not_found`·`upload_size_mismatch` 409 |
| `DELETE /v2/portfolio/photos/{photo_id}` | `photo_id` | 204. 객체 삭제는 정리 장부로 간다 | `portfolio_photo_not_found` 404 |
| `PUT /v2/portfolio/photos/order` | `PortfolioOrderRequest`: `ids` | `Portfolio` 200 | `order_mismatch` 422 |
| `PUT /v2/portfolio/share` | `PortfolioShareRequest`: `enabled` | `PortfolioShare` 200 | 422 배열 |
| `GET /v2/public/portfolios/{slug}` | `slug`. 로그인 없음, 게이트 밖 | `PublicPortfolio` 200(경력에 id 없음, 사진은 `url`만), `X-Robots-Tag: noindex, nofollow` | `portfolio_not_found` 404, IP 한도 429 |

공개 조회를 뺀 입구는 모두 헤더 `Authorization`(게이트를 지난 회원)을 받는다.

## 상태
portfolio_photos:

| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| 올리는 중(`uploaded_at` 없음, 시한 전) | 사진 주소 받기 | account.portfolio |
| 올림(`uploaded_at`, `sort_order`) | 끝 알리기 | account.portfolio |
| 시한 지남 | 주소를 받고 30분 안에 끝 알리기 없음 | — |
| 행 없음 | 삭제, 시한 지난 올리기는 다음 주소 받기 때, 탈퇴 | account.portfolio, account.withdraw |

불변 조건: 올린 사진은 순서를 가진다(`ck_portfolio_photos_uploaded_has_order`). 끝 상태는 행 없음이다.
portfolios 행은 처음 저장할 때 생기고 탈퇴 때 행째 지운다. 공유 링크는 켬·끔 값이며 상태 전이가 없다.

## 데이터
| 항목 | 형식 | 필수 |
|---|---|---|
| 소개글 | 여러 줄 텍스트 | 선택 |
| 경력 | 작품명, 역할, 연도, 종류(영화·드라마·연극·뮤지컬·광고·기타) 여러 개 | 선택 |
| 사진 | 최대 10장, 순서 있음 | 선택 |
| 공유 링크 | 켬·끔, 주소의 난수 slug | |

경력 종류의 저장 값은 film·drama·play·musical·ad·other다. 소개글은 2,000자, 작품명과 역할은 각 1~100자(빈 값
불가), 경력은 50개까지이고 연도는 1900년부터 내년까지다(한국 시간의 오늘에서 센다). 길이는 code point로 센다. 값의
형태가 틀리면 422 배열이고, 개수 상한과 순서 불일치는 사유 코드 하나다.

항목은 셋뿐이다. 신체 정보·특기는 받지 않는다. 공개 페이지에는 프로필의 이름·사진·성별·만 나이를
가져와 함께 보이고, 추구하는 방향·경력 구간·목표는 보이지 않는다. 성별이 "선택 안 함"이면 성별 칸을
뺀다.

## 규칙·제약
- 포트폴리오는 회원당 하나이며 처음 편집할 때 만든다. 전부 선택 항목이라 빈 채로도 저장된다.
- 항목마다 따로 저장한다. 경력과 사진은 추가·수정·삭제·순서 바꾸기가 된다.
- 사진은 10장까지다. 올리는 중인 사진(주소를 받고 30분 안에 끝내지 않은 것)도 장수에 센다. 주소만 받아 놓고
  열 장을 넘기지 못하게 하기 위해서다. 받는 형식, 앱이 줄여 올리는 것, 장당 크기 제한과 413·415는 프로필 사진과
  같다([account.profile](profile.md#규칙제약)). 사진 객체는 영상과 같은 저장소에 두되 videos와 별개다. 프로필
  사진과도 별개다.
- 공유 링크는 기본 꺼짐이다. 처음 켤 때 난수 slug가 생기고 웹의 공개 페이지가 로그인 없이 열린다.
  끄면 404이고 다시 켜면 같은 주소가 다시 열린다. 끄는 것도 켜는 것도 같은 값을 다시 보내면 200이다. 응답의
  `url`은 웹 공개 페이지 주소(`/p/<slug>`)이고 서버에 사이트 주소 설정이 없으면 null이다. 편집은 앱에서만 한다.
- 공개 페이지는 검색 엔진에 노출하지 않는다(noindex). 링크를 아는 사람만 본다. 공개 조회는 IP별로 분당
  60회까지다. 주소를 마구 찔러 보는 것을 늦춘다.
- 공개 페이지는 연습·분석·챌린지 등 다른 자료를 보이지 않는다.
- 게스트는 포트폴리오가 없다.

## 예외
- 링크가 꺼졌거나 없는 slug, 탈퇴한 사람의 slug: 모두 같은 404.
- 열한 번째 사진은 422. 쉰한 번째 경력도 422.
- 이미 지운 경력·사진을 다시 지우면 404.
- 순서 바꾸기에 보낸 목록이 지금 목록과 다르면(다른 기기에서 그 사이 추가·삭제, 빠짐·중복·모르는 id) 422이고
  아무것도 바꾸지 않는다. 앱은 목록을 다시 받는다.
- 링크를 켠 채 프로필의 이름·사진을 바꾸면 공개 페이지도 바뀐다.
- 다른 기기의 탈퇴와 겹친 저장은 [공통 규칙](../common.md#탈퇴와-겹친-쓰기)을 따른다.

## 검증 방법
- 편집 화면에서 경력 둘과 사진 셋을 저장하고 다시 열면 그대로 보인다. 순서를 바꿔 저장하면 순서가
  유지된다.
- 링크를 켜고 브라우저에서 주소를 열면: 이름·프로필 사진·성별·만 나이·소개글·경력·포트폴리오 사진이
  보이고 연습·분석은 없다.
- 링크를 끄고 같은 주소: 404. 다시 켜면 같은 주소가 열린다.
- 링크를 켠 상태에서 탈퇴: 같은 주소가 404이고 portfolios·portfolio_credits·portfolio_photos
  행과 사진 객체가 없다.
- 열한 번째 사진 추가: 422.
- 같은 경력을 두 번 지우면: 두 번째는 404. 한 IP에서 1분에 61번째 공개 조회: 429.
- 공개 페이지 주소를 열면: 응답에 noindex 메타가 있다.
- 성별이 "선택 안 함"인 회원의 공개 페이지: 성별 칸이 없다.
- 게스트 토큰으로 포트폴리오 API: 403.

## 범위 밖
- PDF 내보내기. 공개 페이지와 같은 내용을 파일 하나로 내는 기능이며 후속에서 요구사항을 정한다.
- 공유 링크의 주소 바꾸기. 링크가 원치 않는 사람에게 넘어가면 0.1.0에서는 링크를 끈다. 다시 켜면
  같은 주소라 그 사람에게도 다시 열리며, 0.1.0은 이를 받아들인다. 후속.

## 열린 질문
- 편집 화면과 공개 페이지가 pen에 없다.
