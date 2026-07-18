from fastapi import FastAPI
from google import genai

from acting_agent.config import load_settings
from acting_agent.router import build_router
from acting_agent.store import InMemorySessionStore


def create_app(*, client=None, settings=None, store=None) -> FastAPI:
    settings = settings or load_settings()
    client = client or genai.Client(api_key=settings.api_key)
    if store is None:
        store = InMemorySessionStore()
    app = FastAPI(title="acting-agent")

    @app.get("/health")
    def health():
        return {"status": "ok", "model": settings.model}

    app.include_router(build_router(client=client, settings=settings, store=store))

    return app
