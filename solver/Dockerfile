# Rosterly Module 5 scheduler — AWS Lambda container image.
#
# A container image rather than a zip layer because OR-Tools is far too large
# for the 250 MB unzipped layer limit (TECH_STACK §3.3). Python 3.12 is the
# documented runtime target.
FROM public.ecr.aws/lambda/python:3.12

# Dependencies first so the layer caches across code changes.
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY app/ ${LAMBDA_TASK_ROOT}/app/

# The Lambda base image is slim and ships no system IANA tz database; tzdata
# (in requirements.txt) is what lets zoneinfo resolve Australia/Sydney.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

CMD ["app.lambda_handler.handler"]
