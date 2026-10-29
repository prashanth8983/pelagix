# Engine API. Build context: the repository root (it needs engine/ and configs/).
#
#   docker build -f engine/Dockerfile -t scorebase-engine .
#
# SCOREBASE_HOME holds configs/ and data/. Mount data/ (the DuckDB file, source files, run
# logs) and configs/ (edited by the app) as volumes so they outlive the container.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SCOREBASE_HOME=/srv/scorebase \
    SCOREBASE_PROJECT=retail

WORKDIR /srv/scorebase
COPY engine/ ./engine/
RUN pip install -e "./engine[agent]"
COPY configs/ ./configs/
RUN mkdir -p data
VOLUME ["/srv/scorebase/data", "/srv/scorebase/configs"]

EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "\
import os,urllib.request;\
t=os.environ.get('SCOREBASE_API_TOKEN','');\
r=urllib.request.Request('http://127.0.0.1:8787/health',headers={'Authorization':'Bearer '+t} if t else {});\
urllib.request.urlopen(r,timeout=2)"
CMD ["sh", "-c", "python -m scorebase.api ${SCOREBASE_PROJECT:-retail} --host 0.0.0.0 --port 8787"]
