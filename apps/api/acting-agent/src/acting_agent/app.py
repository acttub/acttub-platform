import os

from fastapi import FastAPI

from acting_agent.router import build_router
from acting_agent.store import InMemorySessionStore


def create_app(*, store=None, generate=None) -> FastAPI:
    if store is None:
        store = InMemorySessionStore()
    app = FastAPI(title="acting-agent")

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "model": os.environ.get("OPENAI_CHAT_MODEL", "gpt-5.6-terra"),
        }

    app.include_router(build_router(store=store, generate=generate))
    return app
