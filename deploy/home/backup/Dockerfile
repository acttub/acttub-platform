FROM postgres:18-alpine

RUN apk add --no-cache aws-cli python3 tzdata
COPY backup.py /opt/backup/backup.py
ENV TZ=Asia/Seoul
ENTRYPOINT ["python3", "/opt/backup/backup.py"]
CMD ["schedule"]
