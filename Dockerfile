# Dockerfile
FROM ubuntu:25.04
RUN apt-get update && \
    apt-get install -y python3 python3-pip build-essential \
                       proj-bin proj-data libproj-dev
WORKDIR /app
COPY requirements.txt .
# Build only our C-extension from source
RUN pip3 install --upgrade pip && \
    pip3 install --no-binary :all: islamic_times && \
    pip3 install -r requirements.txt
COPY . .
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:$PORT", "--workers", "2"]