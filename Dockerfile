# Dockerfile
FROM python:3.11-slim-bookworm

RUN apt-get update && \
    apt-get install -y \
    python3-full python3-venv python3-dev \
      build-essential \
      proj-bin proj-data libproj-dev \
      autoconf automake libtool pkg-config \
      libffi-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# create a venv in /opt/venv and put it first in PATH
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY requirements.txt .

RUN pip install --upgrade pip \
 && pip install --no-binary islamic_times islamic_times --verbose \
 && pip install --prefer-binary -r requirements.txt --verbose

COPY . .

CMD ["sh","-c","gunicorn app:app --bind 0.0.0.0:$PORT --workers 2"]


# FROM python:3.11-slim-bookworm

# # -------------------------------------------------
# # 1. Extra debug symbols for the interpreter & C lib
# # -------------------------------------------------
# RUN apt-get update && \
#     apt-get install -y --no-install-recommends \
#         libproj25 libgeos-c1v5 libffi-dev \
#         python3-dbg libpython3.11-dbg libc6-dbg \
#         gdb strace \
#         && rm -rf /var/lib/apt/lists/*

# WORKDIR /app

# # -----------------------------------------
# # 2. Build every C extension with symbols
# # -----------------------------------------
# ENV CFLAGS="-O0 -g3 -fno-omit-frame-pointer" \
#     CXXFLAGS="$CFLAGS" \
#     LDFLAGS="-g" \
#     PYTHONFAULTHANDLER=1          \
#     # keep core files
#     SOFT_COREFILE_LIMIT="unlimited"

# # Lightweight venv
# RUN python -m venv /opt/venv
# ENV PATH="/opt/venv/bin:${PATH}"

# COPY requirements.txt .

# RUN pip install --upgrade pip && \
#     pip install --prefer-binary -r requirements.txt --verbose

# COPY . .

# # -------------------------------------------------
# # 3. GDB script – much richer output on crash
# # -------------------------------------------------
# CMD ["bash", "-c", "\
#       ulimit -c $SOFT_COREFILE_LIMIT && \
#       gdb --batch \
#           -ex 'set pagination off' \
#           -ex 'set print pretty on' \
#           -ex 'run' \
#           -ex 'echo \\n\\n--- BACKTRACE ---\\n' \
#           -ex 'thread apply all bt full' \
#           -ex 'echo \\n--- REGISTERS ---\\n' \
#           -ex 'info registers' \
#           -ex 'echo \\n--- DISASSEMBLY (current frame) ---\\n' \
#           -ex 'disassemble' \
#           -ex 'quit' \
#           --args /opt/venv/bin/python -X faulthandler -c \"from islamic_times.islamic_times import ITLocation; ITLocation()\""]