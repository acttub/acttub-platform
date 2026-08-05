import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from acting_summary import compress as compress_mod
from acting_summary import summarizer as summarizer_mod
from acting_summary.config import Settings
from acting_summary.schema import ActorMaterial
from acting_summary.store import SummaryStore

# 업로드 상한. 스트리밍 수신이라 메모리와 무관 — 앱 제한(500MB)보다 여유를 둔다.
MAX_UPLOAD_MB = 550
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
_CHUNK_BYTES = 1024 * 1024


def _too_large() -> HTTPException:
    return HTTPException(
        status_code=413,
        detail=f"영상이 {MAX_UPLOAD_MB}MB를 넘어요. 한 장면(3분 이내)만 잘라서 다시 올려주세요.",
    )


def build_router(*, client, settings: Settings, store: SummaryStore) -> APIRouter:
    router = APIRouter(tags=["summary"])

    @router.post("/summarize")
    async def summarize_endpoint(
        request: Request,
        user_id: str = Form(...),
        situation: str = Form(...),
        character: str = Form(...),
        goal: str = Form(...),
        blockage_kind: str = Form("그 외"),
        blockage_detail: str = Form(""),
        duration_ms: int = Form(...),
        video: UploadFile = File(...),
    ):
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit():
            if int(content_length) > MAX_UPLOAD_BYTES + _CHUNK_BYTES:
                raise _too_large()
        actor = ActorMaterial(
            situation=situation,
            character=character,
            goal=goal,
            blockage_kind=blockage_kind,
            blockage_detail=blockage_detail,
            duration_ms=duration_ms,
        )
        video_filename = video.filename
        suffix = Path(video_filename or "video.mp4").suffix or ".mp4"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        send_path = tmp.name
        try:
            # 통째로 read()하면 큰 영상에서 OOM — 청크 단위로 디스크에 흘려 쓴다
            received = 0
            while chunk := await video.read(_CHUNK_BYTES):
                received += len(chunk)
                if received > MAX_UPLOAD_BYTES:
                    raise _too_large()
                tmp.write(chunk)
            tmp.close()

            # 동기 압축·Gemini 파이프라인을 워커 스레드로 — 이벤트 루프 블로킹 방지
            def _compress_and_summarize():
                nonlocal send_path
                send_path = compress_mod.compress_for_gemini(tmp.name)
                observation_pack = summarizer_mod.summarize(
                    send_path, actor, client=client, model=settings.model
                )
                summary_id = store.create_summary(
                    user_id=user_id,
                    actor=actor,
                    observation_pack=observation_pack,
                    video_filename=video_filename,
                    video_size_bytes=received,
                    was_compressed=send_path != tmp.name,
                    model=settings.model,
                )
                return {
                    **observation_pack.model_dump(mode="json"),
                    "summary_id": summary_id,
                }

            return await run_in_threadpool(_compress_and_summarize)
        except summarizer_mod.FileActiveTimeout as exc:
            raise HTTPException(status_code=504, detail=str(exc))
        except summarizer_mod.SummaryParseError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        finally:
            for path in {tmp.name, send_path}:
                if os.path.exists(path):
                    os.unlink(path)

    return router
