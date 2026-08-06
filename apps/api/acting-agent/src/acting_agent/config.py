import os
from dataclasses import dataclass


@dataclass
class Settings:
    api_key: str = ""
    model: str = "gpt-5.6-terra"


def load_settings() -> Settings:
    return Settings(
        api_key=os.environ.get("OPENAI_API_KEY", ""),
        model=os.environ.get("OPENAI_CHAT_MODEL", "gpt-5.6-terra"),
    )
