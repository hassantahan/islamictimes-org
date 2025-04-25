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


# Use a stable Python version on a stable Debian base
FROM python:3.11-slim-bookworm

# Install system dependencies required by timezonefinder's underlying libraries
# timezonefinder often requires libproj and libgeos
# slim images are minimal, so we likely need to install these
# libffi-dev is also commonly needed for various Python libraries
# Install gdb for debugging
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libproj25 libgeos-c1d libffi-dev \
    gdb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# create a venv in /opt/venv and put it first in PATH
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY requirements.txt .

# Install Python dependencies using the venv
# Ensure requirements.txt contains exact versions from your working environment
RUN pip install --upgrade pip \
 && pip install --prefer-binary -r requirements.txt --verbose

COPY . .

# --- TEMPORARY DEBUGGING CMD ---
# This CMD runs the minimal crashing Python command under GDB.
# GDB is configured to print a backtrace ('bt') when the program receives a signal (like SIGSEGV).
# The output will appear in your Render service logs.
#
# GDB commands:
# - `--batch`: Run in batch mode (non-interactive), exit after commands.
# - `-ex "set pagination off"`: Prevent GDB from pausing output.
# - `-ex "run"`: Start the program being debugged.
# - `-ex "bt"`: Print the backtrace.
# - `--args`: The rest of the command is the program and its arguments.
#
# This command will cause the container to exit after the crash and GDB finishes.
# The backtrace should be visible in the Render logs.
CMD ["/usr/bin/gdb", "--batch", \
     "-ex", "set pagination off", \
     "-ex", "run", \
     "-ex", "bt", \
     "--args", "/opt/venv/bin/python", \
     "-c", "from islamic_times.islamic_times import ITLocation; loc = ITLocation()"]

# --- ORIGINAL CMD (Commented out for debugging) ---
# Remember to uncomment and revert to this CMD after you have captured the backtrace!
# CMD ["/opt/venv/bin/gunicorn", "app:app", "--bind", "0.0.0.0:$PORT", "--workers", "2"]