import os

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="acting-report")

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "model": os.environ.get("OPENAI_CHAT_MODEL", "gpt-5.6-terra"),
        }

    return app
