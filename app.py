import asyncio
import os
from pathlib import Path

from aiohttp import web


DATA = os.urandom(1024 * 1024)
PAGE = Path(__file__).with_name("index.html").read_bytes()
NO_STORE = {"Cache-Control": "no-store, no-transform"}


async def index(_):
    return web.Response(body=PAGE, content_type="text/html", headers=NO_STORE)


async def ping(_):
    return web.Response(status=204, headers=NO_STORE)


async def download(request):
    response = web.StreamResponse(
        headers={
            **NO_STORE,
            "Content-Type": "application/octet-stream",
            "X-Accel-Buffering": "no",
        }
    )
    try:
        await response.prepare(request)
        while True:
            await response.write(DATA)
    except OSError:
        raise asyncio.CancelledError


async def upload(request):
    try:
        async for _ in request.content.iter_any():
            pass
    except OSError:
        raise asyncio.CancelledError
    return web.Response(status=204, headers=NO_STORE)


app = web.Application()
app.add_routes(
    [
        web.get("/", index),
        web.get("/ping", ping),
        web.get("/download", download, allow_head=False),
        web.post("/upload", upload),
    ]
)


if __name__ == "__main__":
    web.run_app(
        app,
        host="0.0.0.0",
        port=8080,
        access_log=None,
        handler_cancellation=True,
    )
