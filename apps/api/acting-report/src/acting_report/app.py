from fastapi import FastAPI
from google import genai

from acting_report.config import load_settings
from acting_report.router import build_router
from acting_report.store import FileReportStore


def create_app(*, client=None, settings=None, store=None) -> FastAPI:
    settings = settings or load_settings()
    client = client or genai.Client(api_key=settings.api_key)
    store = store or FileReportStore(settings.store_path)
    app = FastAPI(title="acting-report")

    @app.get("/health")
    def health():
        return {"status": "ok", "model": settings.model}

    app.include_router(build_router(client=client, settings=settings, store=store))

    return app
