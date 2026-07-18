# acting-summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 유저가 영상 + 서브텍스트(상황·인물설정·서브텍스트)를 보내면 Gemini가 영상을 직접 보고, 다음 단계 챗 LLM이 쓰기 좋은 통합 요약 1개(JSON)를 만들어 FastAPI로 돌려준다.

**Architecture:** FastAPI 엔드포인트가 multipart로 영상+서브텍스트를 받아 임시 저장 → `summarizer`가 google-genai Files API로 업로드 후 `generate_content`를 단일 호출(Approach C)로 호출 → 이중 필드 JSON(`full_observation`/`summary`/`intent_alignment`/`anomalies`)을 반환. genai client는 주입식이라 전 계층이 mock 가능.

**Tech Stack:** Python 3.11 · uv · FastAPI + uvicorn · google-genai · pydantic · python-dotenv · pytest

## Global Constraints

- Python `>=3.11`, 패키지 매니저 `uv`, 실행은 `py -m uv run ...` (uv가 PATH에 없음)
- google-genai `>=2.9.0`, import는 `from google import genai`
- API 키: `../video-feedback/.env`의 `GEMINI_API_KEY` 로드 (자체 `.env` 폴백)
- 모델 기본값: `gemini-2.5-flash` (env `GEMINI_MODEL`로 override)
- **유료 API 헌법**: 모든 유닛테스트는 genai를 mock → 실제 호출 0. 실제 Gemini 호출(통합테스트·서버 실가동)은 사용자 승인받고만.
- 출력 스키마는 4필드 고정: `full_observation`, `summary`, `intent_alignment`, `anomalies[]`(`timestamp`/`what`/`why_odd`). 요약 단계는 점수/순위/판정 금지.
- 패키지 디렉토리: `src/acting_summary/`, 테스트: `tests/`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `pyproject.toml` | uv 프로젝트 정의, 의존성, pytest marker |
| `.gitignore` | `.venv`, `__pycache__`, `.env`, 임시파일 제외 |
| `src/acting_summary/__init__.py` | 패키지 마커 |
| `src/acting_summary/config.py` | `.env` 로드 → `Settings(api_key, model)` |
| `src/acting_summary/schema.py` | pydantic: `SubText`, `Anomaly`, `SceneSummary` |
| `src/acting_summary/prompt.py` | 서브텍스트 주입 + 4규칙 프롬프트 빌더 |
| `src/acting_summary/summarizer.py` | 업로드→ACTIVE대기→호출→파싱→정리. 예외 정의 |
| `src/acting_summary/app.py` | FastAPI `create_app()`: `POST /summarize`, `GET /health` |
| `tests/test_config.py` ~ `tests/test_app.py` | 각 단위 테스트 (mock) |
| `tests/test_integration_gemini.py` | opt-in 실제 호출 (`@pytest.mark.gemini`) |

---

### Task 1: 프로젝트 스캐폴딩 + config

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `src/acting_summary/__init__.py`, `src/acting_summary/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Produces: `Settings` (dataclass: `api_key: str`, `model: str`), `load_settings(env_path: Path | None = None) -> Settings`

- [ ] **Step 1: pyproject.toml 작성**

```toml
[project]
name = "acting-summary"
version = "0.1.0"
description = "영상 + 서브텍스트 → Gemini 통합 요약 (다음 단계 LLM 입력용)"
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn>=0.34",
    "google-genai>=2.9.0",
    "pydantic>=2.9",
    "python-dotenv>=1.0",
    "python-multipart>=0.0.9",
]

[build-system]
requires = ["uv_build>=0.11.23,<0.12.0"]
build-backend = "uv_build"

[dependency-groups]
dev = [
    "pytest>=9.1.1",
    "httpx>=0.27",
]

[tool.pytest.ini_options]
markers = [
    "gemini: 실제 Gemini API 호출 (opt-in, 기본 skip)",
]
```

- [ ] **Step 2: .gitignore 작성**

```gitignore
.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.env
*.tmp
```

- [ ] **Step 3: `src/acting_summary/__init__.py` 생성 (빈 파일)**

```python
```

- [ ] **Step 4: 실패 테스트 작성** — `tests/test_config.py`

```python
from pathlib import Path

import pytest

from acting_summary.config import Settings, load_settings


def test_load_settings_reads_key_and_default_model(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    settings = load_settings(env_path=Path("does-not-exist.env"))
    assert isinstance(settings, Settings)
    assert settings.api_key == "test-key"
    assert settings.model == "gemini-2.5-flash"


def test_load_settings_model_override(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-pro")
    settings = load_settings(env_path=Path("does-not-exist.env"))
    assert settings.model == "gemini-2.5-pro"


def test_load_settings_missing_key_raises(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        load_settings(env_path=Path("does-not-exist.env"))
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `py -m uv run pytest tests/test_config.py -v`
Expected: FAIL (`ModuleNotFoundError: acting_summary.config`)

- [ ] **Step 6: config.py 구현** — `src/acting_summary/config.py`

```python
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_MODEL = "gemini-2.5-flash"


@dataclass
class Settings:
    api_key: str
    model: str


def _default_env_path() -> Path:
    # src/acting_summary/config.py -> parents[2] == 프로젝트 루트(acting-summary)
    project_root = Path(__file__).resolve().parents[2]
    return project_root.parent / "video-feedback" / ".env"


def load_settings(env_path: Path | None = None) -> Settings:
    if env_path is None:
        env_path = _default_env_path()
    if env_path.exists():
        load_dotenv(env_path)
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY not found. Set it in ../video-feedback/.env or the environment."
        )
    model = os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)
    return Settings(api_key=api_key, model=model)
```

- [ ] **Step 7: 의존성 설치 + 테스트 통과 확인**

Run: `py -m uv sync` 후 `py -m uv run pytest tests/test_config.py -v`
Expected: 3 passed

- [ ] **Step 8: 커밋**

```bash
git add pyproject.toml .gitignore src/acting_summary/__init__.py src/acting_summary/config.py tests/test_config.py uv.lock
git commit -m "feat: 프로젝트 스캐폴딩 + config (env 로드)"
```

---

### Task 2: schema (pydantic 모델)

**Files:**
- Create: `src/acting_summary/schema.py`
- Test: `tests/test_schema.py`

**Interfaces:**
- Produces:
  - `SubText(situation: str, character: str, subtext: str)`
  - `Anomaly(timestamp: str, what: str, why_odd: str)`
  - `SceneSummary(full_observation: str, summary: str, intent_alignment: str, anomalies: list[Anomaly])`

- [ ] **Step 1: 실패 테스트 작성** — `tests/test_schema.py`

```python
import pytest
from pydantic import ValidationError

from acting_summary.schema import Anomaly, SceneSummary, SubText


def test_subtext_fields():
    s = SubText(situation="카페", character="소심한 신입", subtext="사실은 화남")
    assert s.situation == "카페"
    assert s.character == "소심한 신입"
    assert s.subtext == "사실은 화남"


def test_scene_summary_roundtrip():
    data = {
        "full_observation": "전체 관찰",
        "summary": "압축 요약",
        "intent_alignment": "의도 대비 정렬",
        "anomalies": [{"timestamp": "00:12", "what": "갑자기 웃음", "why_odd": "서브텍스트와 충돌"}],
    }
    s = SceneSummary.model_validate(data)
    assert s.anomalies[0].timestamp == "00:12"
    assert isinstance(s.anomalies[0], Anomaly)
    assert s.model_dump() == data


def test_scene_summary_missing_field_raises():
    with pytest.raises(ValidationError):
        SceneSummary.model_validate({"summary": "x"})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `py -m uv run pytest tests/test_schema.py -v`
Expected: FAIL (`ModuleNotFoundError: acting_summary.schema`)

- [ ] **Step 3: schema.py 구현** — `src/acting_summary/schema.py`

```python
from pydantic import BaseModel, Field


class SubText(BaseModel):
    situation: str = Field(description="상황")
    character: str = Field(description="인물설정")
    subtext: str = Field(description="서브텍스트")


class Anomaly(BaseModel):
    timestamp: str = Field(description="대략 시점 (예: 00:12)")
    what: str = Field(description="관찰된 이상/부자연/의도이탈")
    why_odd: str = Field(description="왜 눈에 띄는지")


class SceneSummary(BaseModel):
    full_observation: str = Field(description="시간순 전체 관찰, 손실 최소")
    summary: str = Field(description="서브텍스트 대비 압축 요약")
    intent_alignment: str = Field(description="상황/인물설정/서브텍스트 의도 대비 실제 연기")
    anomalies: list[Anomaly] = Field(description="이상징후 목록, 절대 생략 금지")
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `py -m uv run pytest tests/test_schema.py -v`
Expected: 3 passed

- [ ] **Step 5: 커밋**

```bash
git add src/acting_summary/schema.py tests/test_schema.py
git commit -m "feat: SubText/Anomaly/SceneSummary 스키마"
```

---

### Task 3: prompt 빌더

**Files:**
- Create: `src/acting_summary/prompt.py`
- Test: `tests/test_prompt.py`

**Interfaces:**
- Consumes: `SubText` (Task 2)
- Produces: `build(subtext: SubText) -> str`

- [ ] **Step 1: 실패 테스트 작성** — `tests/test_prompt.py`

```python
from acting_summary.prompt import build
from acting_summary.schema import SubText


def test_build_injects_subtext_fields():
    s = SubText(situation="면접장", character="긴장한 지원자", subtext="합격에 필사적")
    text = build(s)
    assert "면접장" in text
    assert "긴장한 지원자" in text
    assert "합격에 필사적" in text


def test_build_contains_four_rules():
    s = SubText(situation="a", character="b", subtext="c")
    text = build(s)
    # 4규칙의 핵심 키워드가 들어가는지
    assert "full_observation" in text
    assert "summary" in text
    assert "anomalies" in text
    assert "생략" in text  # 생략 규칙
    assert "판정" in text or "점수" in text  # 판정 금지 규칙
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `py -m uv run pytest tests/test_prompt.py -v`
Expected: FAIL (`ModuleNotFoundError: acting_summary.prompt`)

- [ ] **Step 3: prompt.py 구현** — `src/acting_summary/prompt.py`

```python
from acting_summary.schema import SubText


def build(subtext: SubText) -> str:
    return f"""너는 연기 영상 분석가다. 첨부된 영상을 직접 보고, 다음 단계의 코칭 챗봇 LLM이 그대로 받아 쓸 통합 요약을 JSON으로만 만든다.

[상황]
{subtext.situation}

[인물설정]
{subtext.character}

[서브텍스트]
{subtext.subtext}

규칙:
1. full_observation: 영상에서 일어난 일을 시간순으로, 대사·표정·동작·톤까지 손실 최소로 기록한다. 거의 생략하지 않는다.
2. summary: 위 서브텍스트(상황·인물설정·서브텍스트) 대비로 압축한 요약. 다음 LLM이 1차로 읽을 부분. 불필요한 디테일은 생략하되, 의미 손실이 없도록 한다.
3. anomalies: 어색하거나 부자연스럽거나 서브텍스트 의도에서 이탈한 지점을 시점(timestamp)과 함께 모두 적는다. 사소해 보여도 의심되면 적는다. 절대 생략하지 않는다.
4. 점수·순위·합격/불합격 같은 판정은 하지 않는다. 그건 다음 단계 챗봇이 한다. 너는 관찰과 정렬만 한다.

intent_alignment에는 의도 대비 실제 연기가 어떻게 표현되었는지/이탈했는지를 쓴다.
JSON 외 다른 텍스트는 출력하지 않는다."""
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `py -m uv run pytest tests/test_prompt.py -v`
Expected: 2 passed

- [ ] **Step 5: 커밋**

```bash
git add src/acting_summary/prompt.py tests/test_prompt.py
git commit -m "feat: 서브텍스트 주입 프롬프트 빌더 (4규칙)"
```

---

### Task 4: summarizer (핵심, genai mock)

**Files:**
- Create: `src/acting_summary/summarizer.py`
- Test: `tests/test_summarizer.py`

**Interfaces:**
- Consumes: `build` (Task 3), `SceneSummary`/`SubText` (Task 2)
- Produces:
  - `summarize(video_path, subtext: SubText, *, client, model: str, active_timeout: float = 120.0, poll_interval: float = 2.0) -> SceneSummary`
  - 예외: `FileActiveTimeout`, `SummaryParseError`
  - `client`는 google-genai `Client` 호환 객체(`.files.upload/get/delete`, `.models.generate_content`)

- [ ] **Step 1: 실패 테스트 작성** — `tests/test_summarizer.py`

```python
import pytest

from acting_summary.schema import Anomaly, SceneSummary, SubText
from acting_summary.summarizer import (
    FileActiveTimeout,
    SummaryParseError,
    summarize,
)

SUBTEXT = SubText(situation="a", character="b", subtext="c")
SUMMARY = SceneSummary(
    full_observation="f",
    summary="s",
    intent_alignment="i",
    anomalies=[Anomaly(timestamp="00:01", what="w", why_odd="o")],
)


class _State:
    def __init__(self, name):
        self.name = name


class _File:
    def __init__(self, name, state):
        self.name = name
        self.state = _State(state)


class _Resp:
    def __init__(self, parsed=None, text=None):
        self.parsed = parsed
        self.text = text


class _Files:
    def __init__(self, state="ACTIVE"):
        self._state = state
        self.deleted = []

    def upload(self, file):
        return _File("files/abc", self._state)

    def get(self, name):
        return _File(name, self._state)

    def delete(self, name):
        self.deleted.append(name)


class _Models:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))
        return self._responses.pop(0)


class FakeClient:
    def __init__(self, responses, state="ACTIVE"):
        self.files = _Files(state)
        self.models = _Models(responses)


def test_summarize_returns_parsed_and_deletes_file():
    client = FakeClient([_Resp(parsed=SUMMARY)])
    out = summarize("v.mp4", SUBTEXT, client=client, model="m")
    assert out is SUMMARY
    assert client.files.deleted == ["files/abc"]
    assert client.models.calls[0][0] == "m"


def test_summarize_parses_text_when_no_parsed():
    client = FakeClient([_Resp(parsed=None, text=SUMMARY.model_dump_json())])
    out = summarize("v.mp4", SUBTEXT, client=client, model="m")
    assert out.summary == "s"


def test_summarize_retries_once_then_raises():
    client = FakeClient([_Resp(parsed=None, text="not json"), _Resp(parsed=None, text="still bad")])
    with pytest.raises(SummaryParseError):
        summarize("v.mp4", SUBTEXT, client=client, model="m")
    assert len(client.models.calls) == 2  # 1회 재시도
    assert client.files.deleted == ["files/abc"]  # 실패해도 정리


def test_summarize_timeout_when_not_active():
    client = FakeClient([_Resp(parsed=SUMMARY)], state="PROCESSING")
    with pytest.raises(FileActiveTimeout):
        summarize("v.mp4", SUBTEXT, client=client, model="m", active_timeout=0)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `py -m uv run pytest tests/test_summarizer.py -v`
Expected: FAIL (`ModuleNotFoundError: acting_summary.summarizer`)

- [ ] **Step 3: summarizer.py 구현** — `src/acting_summary/summarizer.py`

```python
import time

from google.genai import types

from acting_summary.prompt import build
from acting_summary.schema import SceneSummary, SubText


class FileActiveTimeout(Exception):
    pass


class SummaryParseError(Exception):
    pass


def _wait_active(client, file, timeout, poll_interval):
    deadline = time.monotonic() + timeout
    current = file
    while current.state.name == "PROCESSING":
        if time.monotonic() >= deadline:
            raise FileActiveTimeout(f"file {current.name} not ACTIVE within {timeout}s")
        time.sleep(poll_interval)
        current = client.files.get(name=current.name)
    if current.state.name != "ACTIVE":
        raise FileActiveTimeout(f"file {current.name} state={current.state.name}")
    return current


def _parse(response) -> SceneSummary:
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, SceneSummary):
        return parsed
    text = getattr(response, "text", None)
    if text:
        try:
            return SceneSummary.model_validate_json(text)
        except Exception as exc:  # noqa: BLE001
            raise SummaryParseError(str(exc)) from exc
    raise SummaryParseError("no parseable summary in response")


def summarize(
    video_path,
    subtext: SubText,
    *,
    client,
    model: str,
    active_timeout: float = 120.0,
    poll_interval: float = 2.0,
) -> SceneSummary:
    prompt = build(subtext)
    uploaded = client.files.upload(file=str(video_path))
    try:
        uploaded = _wait_active(client, uploaded, active_timeout, poll_interval)
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=SceneSummary,
        )
        last_err = None
        for _ in range(2):
            response = client.models.generate_content(
                model=model, contents=[uploaded, prompt], config=config
            )
            try:
                return _parse(response)
            except SummaryParseError as exc:
                last_err = exc
        raise SummaryParseError(f"failed to parse after retry: {last_err}")
    finally:
        try:
            client.files.delete(name=uploaded.name)
        except Exception:  # noqa: BLE001
            pass
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `py -m uv run pytest tests/test_summarizer.py -v`
Expected: 4 passed

- [ ] **Step 5: 커밋**

```bash
git add src/acting_summary/summarizer.py tests/test_summarizer.py
git commit -m "feat: summarizer (업로드→ACTIVE대기→호출→파싱→정리, genai mock)"
```

---

### Task 5: FastAPI app

**Files:**
- Create: `src/acting_summary/app.py`
- Test: `tests/test_app.py`

**Interfaces:**
- Consumes: `load_settings`/`Settings` (Task 1), `summarize`/예외 (Task 4), `SubText` (Task 2)
- Produces: `create_app(*, client=None, settings=None) -> FastAPI`
  - `POST /summarize` (Form: `situation`, `character`, `subtext`; File: `video`) → `SceneSummary` JSON
  - `GET /health` → `{"status": "ok", "model": ...}`

- [ ] **Step 1: 실패 테스트 작성** — `tests/test_app.py`

```python
from fastapi.testclient import TestClient

from acting_summary import summarizer as summarizer_mod
from acting_summary.app import create_app
from acting_summary.config import Settings
from acting_summary.schema import Anomaly, SceneSummary

FAKE = SceneSummary(
    full_observation="f",
    summary="s",
    intent_alignment="i",
    anomalies=[Anomaly(timestamp="00:01", what="w", why_odd="o")],
)


def _app():
    return create_app(client=object(), settings=Settings(api_key="x", model="m"))


def test_health():
    c = TestClient(_app())
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "model": "m"}


def test_summarize_endpoint(monkeypatch):
    def fake_summarize(video_path, subtext, *, client, model, **kw):
        assert subtext.situation == "상황"
        assert model == "m"
        return FAKE

    monkeypatch.setattr(summarizer_mod, "summarize", fake_summarize)
    c = TestClient(_app())
    r = c.post(
        "/summarize",
        data={"situation": "상황", "character": "인물", "subtext": "서브"},
        files={"video": ("t.mp4", b"bytes", "video/mp4")},
    )
    assert r.status_code == 200
    assert r.json()["summary"] == "s"
    assert r.json()["anomalies"][0]["timestamp"] == "00:01"


def test_summarize_missing_video_422():
    c = TestClient(_app())
    r = c.post("/summarize", data={"situation": "a", "character": "b", "subtext": "c"})
    assert r.status_code == 422


def test_summarize_timeout_maps_504(monkeypatch):
    def boom(*a, **k):
        raise summarizer_mod.FileActiveTimeout("nope")

    monkeypatch.setattr(summarizer_mod, "summarize", boom)
    c = TestClient(_app())
    r = c.post(
        "/summarize",
        data={"situation": "a", "character": "b", "subtext": "c"},
        files={"video": ("t.mp4", b"bytes", "video/mp4")},
    )
    assert r.status_code == 504
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `py -m uv run pytest tests/test_app.py -v`
Expected: FAIL (`ModuleNotFoundError: acting_summary.app`)

- [ ] **Step 3: app.py 구현** — `src/acting_summary/app.py`

```python
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from google import genai

from acting_summary import summarizer as summarizer_mod
from acting_summary.config import load_settings
from acting_summary.schema import SubText


def create_app(*, client=None, settings=None) -> FastAPI:
    settings = settings or load_settings()
    client = client or genai.Client(api_key=settings.api_key)
    app = FastAPI(title="acting-summary")

    @app.get("/health")
    def health():
        return {"status": "ok", "model": settings.model}

    @app.post("/summarize")
    async def summarize_endpoint(
        situation: str = Form(...),
        character: str = Form(...),
        subtext: str = Form(...),
        video: UploadFile = File(...),
    ):
        subtext_obj = SubText(situation=situation, character=character, subtext=subtext)
        suffix = Path(video.filename or "video.mp4").suffix or ".mp4"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            tmp.write(await video.read())
            tmp.close()
            return summarizer_mod.summarize(
                tmp.name, subtext_obj, client=client, model=settings.model
            )
        except summarizer_mod.FileActiveTimeout as exc:
            raise HTTPException(status_code=504, detail=str(exc))
        except summarizer_mod.SummaryParseError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)

    return app
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `py -m uv run pytest tests/test_app.py -v`
Expected: 4 passed

- [ ] **Step 5: 전체 테스트 통과 확인**

Run: `py -m uv run pytest -v`
Expected: 모든 유닛테스트 passed (gemini 마커 제외 — 기본 skip/deselect)

- [ ] **Step 6: 커밋**

```bash
git add src/acting_summary/app.py tests/test_app.py
git commit -m "feat: FastAPI create_app (/summarize, /health, 에러 매핑)"
```

---

### Task 6: 통합 테스트(opt-in) + 문서

**Files:**
- Create: `tests/test_integration_gemini.py`, `README.md`, `PROGRESS.md`

**Interfaces:**
- Consumes: `create_app`/`load_settings`/`summarize` 전체

> ⚠️ 이 태스크의 통합 테스트는 **실제 Gemini 호출**이다. 헌법상 **사용자 승인 없이 실행 금지**. 작성만 하고, 실행은 사용자 승인 후 `py -m uv run pytest -m gemini`로만.

- [ ] **Step 1: 통합 테스트 작성** — `tests/test_integration_gemini.py`

```python
import os

import pytest

from acting_summary.config import load_settings
from acting_summary.schema import SceneSummary, SubText
from acting_summary.summarizer import summarize

pytestmark = pytest.mark.gemini


def test_real_gemini_summarize():
    sample = os.environ.get("SAMPLE_VIDEO")
    if not sample or not os.path.exists(sample):
        pytest.skip("SAMPLE_VIDEO env(영상 경로) 미설정")
    settings = load_settings()
    from google import genai

    client = genai.Client(api_key=settings.api_key)
    out = summarize(
        sample,
        SubText(situation="테스트 상황", character="테스트 인물", subtext="테스트 서브텍스트"),
        client=client,
        model=settings.model,
    )
    assert isinstance(out, SceneSummary)
    assert out.summary
```

- [ ] **Step 2: 기본 실행 시 deselect 확인 (실제 호출 안 함)**

Run: `py -m uv run pytest -v`
Expected: 통합 테스트는 deselect/skip, 실제 Gemini 호출 0

- [ ] **Step 3: README.md 작성**

```markdown
# acting-summary

영상 + 서브텍스트(상황·인물설정·서브텍스트) → Gemini가 영상을 직접 보고 통합 요약 1개(JSON) 반환.
다음 단계 코칭 챗 LLM이 받아 쓰는 입력.

## 실행

```powershell
cd C:\Users\RJS\Desktop\project\acting-summary
py -m uv sync
py -m uv run uvicorn acting_summary.app:create_app --factory --reload
# POST http://127.0.0.1:8000/summarize  (multipart: video, situation, character, subtext)
```

## 테스트

```powershell
py -m uv run pytest -q            # 유닛테스트 (전부 mock, 실제 호출 0)
py -m uv run pytest -m gemini     # 실제 Gemini 호출 (SAMPLE_VIDEO 필요, 비용 발생)
```

API 키는 `../video-feedback/.env`의 `GEMINI_API_KEY`를 읽는다.
```

- [ ] **Step 4: PROGRESS.md 작성**

```markdown
# 진행 상황 (acting-summary)

> 한 줄: 영상+서브텍스트 → Gemini 통합 요약(JSON) → 다음 단계 챗 LLM 입력. FastAPI.

## DONE
- config(.env 로드) / schema / prompt(4규칙) / summarizer(genai mock) / FastAPI(/summarize,/health)
- 유닛테스트 전부 mock (실제 API 0). 통합테스트는 `-m gemini` opt-in.

## 다음 켰을 때
```powershell
cd C:\Users\RJS\Desktop\project\acting-summary
py -m uv run pytest -q
py -m uv run uvicorn acting_summary.app:create_app --factory --reload
```

## gotcha
- uv는 `py -m uv ...`. 모델 기본 `gemini-2.5-flash`(env `GEMINI_MODEL` override).
- 실제 Gemini 호출은 사용자 승인 후에만.
- summarizer는 client 주입식 → 전 계층 mock 가능.
```

- [ ] **Step 5: 커밋**

```bash
git add tests/test_integration_gemini.py README.md PROGRESS.md
git commit -m "test: opt-in Gemini 통합테스트 + docs(README/PROGRESS)"
```

---

## Self-Review

- **Spec coverage:** FastAPI(/summarize) ✔Task5 · 영상 직접 업로드+단일호출 ✔Task4 · 이중필드 스키마 ✔Task2 · 서브텍스트 정렬/생략/이상보존 프롬프트 ✔Task3 · .env 키 로드 ✔Task1 · 에러 매핑(422/502/504) ✔Task4·5 · 유료API 헌법(mock/opt-in) ✔Task4·6 · 모델 기본값 ✔Task1.
- **Placeholder scan:** 모든 스텝에 실제 코드/명령/기대출력 포함. placeholder 없음.
- **Type consistency:** `summarize(video_path, subtext, *, client, model, active_timeout, poll_interval)` Task4 정의 == Task5 호출 일치. `SceneSummary` 4필드 Task2 == Task3 프롬프트/Task4 파싱/Task5 반환 일치. `Settings(api_key, model)` Task1 == Task5 사용 일치. 예외명 `FileActiveTimeout`/`SummaryParseError` Task4 정의 == Task5 매핑 일치.
