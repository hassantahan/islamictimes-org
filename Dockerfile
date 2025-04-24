# Dockerfile
FROM ubuntu:25.04

RUN apt-get update && \
    apt-get install -y \
      python3-full python3-venv python3-dev python3-pip \
      build-essential \
      proj-bin proj-data libproj-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# create a venv in /opt/venv and put it first in PATH
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY requirements.txt .

# now pip refers to venv’s pip, not the system one
RUN pip install --upgrade pip \
 && pip install --no-binary :all: islamic_times \
 && pip install -r requirements.txt

COPY . .

CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:$PORT", "--workers", "2"]
