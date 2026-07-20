import asyncio
import logging

logger = logging.getLogger(__name__)


async def keep_alive_loop(url: str, interval_sec: int, client, sleep=asyncio.sleep):
    """설정된 경우 interval마다 자기 /health를 호출하는 opt-in self-ping."""
    target = url.rstrip("/") + "/health"
    while True:
        await sleep(interval_sec)
        try:
            await client.get(target)
        except Exception:
            logger.warning("keep-alive ping failed: %s", target, exc_info=True)
