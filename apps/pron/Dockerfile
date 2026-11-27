# 발음 채점 서비스(SOMA-606). CPU 전용이고 모델은 빌드 때 받아 넣는다 — 실행 중에는 밖으로 나가지 않는다.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
ENV HF_HOME=/models
COPY pronscore.py acoustics.py app.py ./
# 모델 저장소 main 에는 pytorch_model.bin 만 있다. transformers 는 bin 을 받으면 safetensors 변환본(같은 가중치 1.26GB, 다른
# 리비전)도 받아 두는데 실행 때(오프라인)는 main 의 bin 만 읽으므로 받지 않게 한다.
RUN DISABLE_SAFETENSORS_CONVERSION=1 python -c "import pronscore; pronscore.model()"
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PRON_THREADS=2 OMP_NUM_THREADS=2
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD curl -fsS http://localhost:8000/health || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
