"""발음 채점 서비스(SOMA-606) — api 만 부르는 내부 서비스다. 호스트 포트를 열지 않는다.

POST /score  multipart(audio: m4a·wav, text: 대본 한 줄) → pronscore.score_line 결과 + model_version. 짚기는 api 가 정한다
             소리 없는 앞뒤를 잘라 낸 뒤에도 PRON_MAX_SECONDS(기본 60초, api 의 줄 한도와 같다)보다 길면 422 audio_too_long
             timings_ms: 이 요청에 쓴 ms. decode·model·gop 과 받기부터 답 만들기까지 전부(total). api 가 단계별 시간으로 남긴다
POST /measure multipart(audio, text) → acoustics.measure 결과(크기·빠르기·쉼·끝 높이). 말소리가 없으면 {"measured": false}
GET  /health 모델을 올렸는지
"""
import os
import tempfile
import time

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

import acoustics
import pronscore

torch.set_num_threads(int(os.environ.get("PRON_THREADS", "2")))
app = FastAPI()
MAX_BYTES = 10 * 1024 * 1024


@app.on_event("startup")
def warm():
    pronscore.model()


@app.get("/health")
def health():
    return {"ok": True, "model_version": pronscore.MODEL_VERSION}


@app.post("/score")
def score(audio: UploadFile = File(...), text: str = Form(...)):
    started = time.perf_counter()
    body = audio.file.read(MAX_BYTES + 1)
    if not body or len(body) > MAX_BYTES:
        raise HTTPException(413 if body else 400, "audio_size")
    if not text.strip():
        raise HTTPException(400, "empty_text")
    suffix = os.path.splitext(audio.filename or "")[1] or ".m4a"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(body)
        tmp.flush()
        try:
            result = pronscore.score_line(tmp.name, text)
        except pronscore.TooLong as too_long:
            raise HTTPException(422, "audio_too_long") from too_long
    result["timings_ms"]["total"] = int((time.perf_counter() - started) * 1000)
    return {**result, "model_version": pronscore.MODEL_VERSION}


@app.post("/measure")
def measure(audio: UploadFile = File(...), text: str = Form("")):
    body = audio.file.read(MAX_BYTES + 1)
    if not body or len(body) > MAX_BYTES:
        raise HTTPException(413 if body else 400, "audio_size")
    suffix = os.path.splitext(audio.filename or "")[1] or ".m4a"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(body)
        tmp.flush()
        result = acoustics.measure(tmp.name, text)
    return {"measured": False} if result is None else {"measured": True, **result}
