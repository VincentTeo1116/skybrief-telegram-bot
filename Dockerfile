FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot ./bot

# Saved locations live here; mount a persistent volume on /data in production.
ENV DB_PATH=/data/bot.db
RUN mkdir -p /data

CMD ["python", "-m", "bot"]
