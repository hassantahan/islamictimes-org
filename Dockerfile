# # Dockerfile
# FROM python:3.11-slim-bookworm

# RUN apt-get update && \
#     apt-get install -y \
#     python3-full python3-venv python3-dev \
#       build-essential \
#       proj-bin proj-data libproj-dev \
#       autoconf automake libtool pkg-config \
#       libffi-dev \
#     && rm -rf /var/lib/apt/lists/*

# WORKDIR /app

# # create a venv in /opt/venv and put it first in PATH
# RUN python3 -m venv /opt/venv
# ENV PATH="/opt/venv/bin:${PATH}"

# COPY requirements.txt .

# RUN pip install --upgrade pip \
#  && pip install --no-binary islamic_times islamic_times --verbose \
#  && pip install --prefer-binary -r requirements.txt --verbose

# COPY . .

# CMD ["sh","-c","gunicorn app:app --bind 0.0.0.0:$PORT --workers 2"]


FROM python:3.11-slim-bookworm

# Install system dependencies (including GDB and core dump tools)
RUN apt-get update && \
    apt-get install -y \
    python3-full python3-venv python3-dev \
      build-essential \
      proj-bin proj-data libproj-dev \
      autoconf automake libtool pkg-config \
      libffi-dev \
    && rm -rf /var/lib/apt/lists/*
    
WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY requirements.txt .

RUN pip install --upgrade pip \
 && pip install --prefer-binary -r requirements.txt --verbose

COPY . .

# --- IMPORTANT: Configure Core Dumps ---
# Ensure core dumps are generated and saved to a known location
# This pattern saves them as core.<pid> in the current directory
RUN echo "core.%p" > /proc/sys/kernel/core_pattern
# Allow unlimited core dump size
RUN ulimit -c unlimited

# Original CMD (will trigger the crash when ITLocation is initialized)
# CMD ["/opt/venv/bin/gunicorn", "app:app", "--bind", "0.0.0.0:$PORT", "--workers", "2"]

# --- OR, for easier debugging, a CMD that just runs the crashing command ---
CMD ["/opt/venv/bin/python", "-c", "from islamic_times.islamic_times import ITLocation; loc = ITLocation()"]