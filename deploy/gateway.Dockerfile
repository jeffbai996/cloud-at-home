FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY gateway/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY gateway/cloud_gateway ./cloud_gateway
COPY gateway/run.py ./run.py
RUN useradd --uid 1000 --create-home cloud-home && mkdir -p /data && chown cloud-home:cloud-home /data
USER cloud-home
EXPOSE 8079
CMD ["python", "run.py"]
