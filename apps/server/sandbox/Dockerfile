FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/matplotlib \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1
COPY requirements.txt /opt/analysis/requirements.txt
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/analysis/requirements.txt \
    && groupadd --gid 10001 analyst \
    && useradd --uid 10001 --gid 10001 --no-create-home analyst
USER 10001:10001
WORKDIR /work
CMD ["python", "-I", "-u"]
