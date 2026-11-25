# app.blog 웹 블로그

[공통 규칙](../common.md) · [영역 개요](README.md)

- 도입: SOMA-834
- 화면: 웹 `acttub.com/blog`(목록·글), 운영자 화면의 블로그 편집
- 테이블: blog_posts

## 기능
운영자가 쓴 글을 웹 블로그에 싣는다. 운영자는 초안을 만들고 게시하거나 내린다. 누구나 게시된 글만 읽는다.

## 입력·출력
| 입구 | 입력 | 출력 | 오류 |
|---|---|---|---|
| `GET /v2/blog/posts` | 질의 `category`(`practice`·`admissions`·`audition`·`news`, 선택), `limit`(1~50, 기본 20) | 게시된 글 목록 200, `published_at` 새것부터 | 질의 값 위반 422(배열), 429 |
| `GET /v2/blog/posts/{slug}` | 경로 `slug` | 게시된 글 한 편 200 | 없거나 초안 404 `post_not_found`, 429 |
| `GET /v2/blog/images/{name}` | 경로 `name` | 스토리지 주소로 302 | 없음 404 `image_not_found`, 429 |
| `GET /v2/admin/blog/posts` | 헤더 `Authorization: Bearer $ADMIN_OPS_TOKEN` | 초안까지 전부, 최근에 고친 것부터 200 | 토큰 없음·틀림 401 |
| `POST /v2/admin/blog/posts` | 운영 토큰, 글 본문(`slug`·`title`·`summary`·`category`·`body_markdown`·`cover_image_url`·`app_cta`·`status`·`published_at`) | 만든 글 201 | 같은 slug 409 `slug_taken`, 칸 규칙 위반 422(배열), 401 |
| `PATCH /v2/admin/blog/posts/{id}` | 운영 토큰, 바꿀 칸만 | 바뀐 글 200 | 없음 404 `post_not_found`, 같은 slug 409 `slug_taken`, 422, 401 |
| `POST /v2/admin/blog-images` | 운영 토큰, multipart `image` 한 장 | 글에 넣을 주소 200 | PNG·JPEG·WebP 밖 415, 2MB 넘음 413, 401 |

## 상태
| 상태 | 들어오는 전이(조건) | 일으키는 기능 |
|---|---|---|
| draft | 만들기 기본값. 게시한 글을 `status=draft` 로 고침(내리기) | app.blog(운영) |
| published | `status=published` 로 만들거나 고침 | app.blog(운영) |

끝 상태는 없다. 지우는 경로가 없고 내리기가 draft 다. `published_at` 은 처음 게시할 때 한 번 채운다(보낸 값이 있으면 그 값, 없으면 지금).
내렸다 다시 올려도 그대로다.

## 규칙·제약
- 값 목록(`category`·`app_cta`·`status`)은 `BlogRules` 와 DB CHECK 가 같다. slug 는 소문자·숫자와 하이픈, 80자까지이고 유일하다.
- 공개 목록·상세는 `status=published` 만 본다. `published_at` 을 미래로 줘도 게시하면 바로 보인다(예약 게시가 아니다).
- 읽는 시간은 저장하지 않고 본문에서 계산한다(공백 뺀 500자에 1분, 최소 1분).
- 공개 경로는 로그인과 `X-Acttub-Client` 없이 읽는다. 한 IP 가 1분에 120번을 넘으면 429 `rate limit exceeded` 다.

## 예외
- 같은 slug 로 만들거나 고침: 409 `slug_taken`, 아무것도 바뀌지 않는다.

## 검증 방법
- 초안은 공개 목록·상세에 없고(404), 게시한 글은 로그인·클라이언트 헤더 없이 읽힌다. 만료된 토큰이 붙어도 막지 않는다
  (`BlogEndpointIT`).
- 처음 게시할 때 `published_at` 이 한 번 채워지고 내렸다 다시 올려도 그대로다(`BlogEndpointIT`).
- 같은 slug: 409 `slug_taken`. 틀린 slug·빠진 분류: 422. 운영 경로는 토큰이 없으면 401.
- 이미지: PNG·JPEG·WebP 밖은 415, 2MB 넘음 413, 공개 주소는 302(`BlogEndpointIT`).

## 범위 밖
- 글 지우기, 예약 게시, 댓글.

## 열린 질문
- 미래의 `published_at` 을 예약 게시로 볼지.
