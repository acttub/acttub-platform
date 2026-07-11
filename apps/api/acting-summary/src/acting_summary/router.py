import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from acting_summary import summarizer as summarizer_mod
from acting_summary.config import Settings
from acting_summary.schema import SubText


def build_router(*, client, settings: Settings) -> APIRouter:
    router = APIRouter(tags=["summary"])

    @router.post("/summarize")
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
            # 동기 Gemini 파이프라인을 워커 스레드로 — 이벤트 루프 블로킹 방지
            return await run_in_threadpool(
                summarizer_mod.summarize,
                tmp.name,
                subtext_obj,
                client=client,
                model=settings.model,
            )
        except summarizer_mod.FileActiveTimeout as exc:
            raise HTTPException(status_code=504, detail=str(exc))
        except summarizer_mod.SummaryParseError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)

    return router
