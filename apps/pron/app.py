"""발음 채점 서비스(SOMA-606) — api 만 부르는 내부 서비스다. 호스트 포트를 열지 않는다.

POST /score  multipart(audio: m4a·wav, text: 대본 한 줄, threshold?) → pronscore.score_line 결과 + model_version
GET  /health 모델을 올렸는지
"""
import os
import tempfile

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

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
def score(audio: UploadFile = File(...), text: str = Form(...), threshold: float = Form(pronscore.THRESHOLD)):
    body = audio.file.read(MAX_BYTES + 1)
    if not body or len(body) > MAX_BYTES:
        raise HTTPException(413 if body else 400, "audio_size")
    if not text.strip():
        raise HTTPException(400, "empty_text")
    suffix = os.path.splitext(audio.filename or "")[1] or ".m4a"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(body)
        tmp.flush()
        result = pronscore.score_line(tmp.name, text, threshold)
    return {**result, "model_version": pronscore.MODEL_VERSION}
