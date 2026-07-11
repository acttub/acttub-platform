import asyncio
import logging

logger = logging.getLogger(__name__)


async def keep_alive_loop(url: str, interval_sec: int, client, sleep=asyncio.sleep):
    """interval마다 자기 /health를 GET — Render 무료 티어 유휴 슬립 방지."""
    target = url.rstrip("/") + "/health"
    while True:
        await sleep(interval_sec)
        try:
            await client.get(target)
        except Exception:
            logger.warning("keep-alive ping failed: %s", target, exc_info=True)
