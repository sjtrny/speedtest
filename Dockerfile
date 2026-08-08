FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir aiohttp==3.14.3
COPY app.py index.html ./
USER 65532:65532
CMD ["python", "app.py"]
