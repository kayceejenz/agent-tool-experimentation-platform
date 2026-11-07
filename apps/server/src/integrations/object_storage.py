"""Private R2 objects; local files remain the default development backend."""

from functools import lru_cache
from pathlib import Path, PurePosixPath

from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError


class StorageUnavailable(Exception):
    """Sanitized storage error; never expose SDK request/credential details."""


class R2Storage:
    def __init__(self, client, bucket, prefix):
        self.client, self.bucket, self.prefix = client, bucket, prefix.strip("/")

    def key(self, key):
        path = PurePosixPath(key)
        if path.is_absolute() or ".." in path.parts or not key or "\\" in key:
            raise ValueError("Invalid object key")
        return self.prefix + "/" + key

    def upload(self, key, path, content_type="application/octet-stream"):
        try:
            with Path(path).open("rb") as source:
                # Single PUT: our files are bounded; avoid background transfer threads.
                self.client.put_object(
                    Bucket=self.bucket,
                    Key=self.key(key),
                    Body=source,
                    ContentType=content_type,
                )
        except (BotoCoreError, ClientError, OSError):
            raise StorageUnavailable("File storage unavailable") from None

    def read(self, key, limit, preview=False):
        body = None
        try:
            args = {"Bucket": self.bucket, "Key": self.key(key)}
            if preview:
                args["Range"] = f"bytes=0-{limit - 1}"
            response = self.client.get_object(**args)
            body = response["Body"]
            if not preview and response.get("ContentLength", 0) > limit:
                raise StorageUnavailable("Stored file exceeds its limit")
            data = body.read(limit + 1)
            if len(data) > limit:
                raise StorageUnavailable("Stored file exceeds its limit")
            return data
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {
                "NoSuchKey",
                "404",
                "NotFound",
            }:
                raise FileNotFoundError("Stored file unavailable") from None
            raise StorageUnavailable("File storage unavailable") from None
        except (BotoCoreError, OSError):
            raise StorageUnavailable("File storage unavailable") from None
        finally:
            if body is not None:
                body.close()

    def download(self, key, path, limit):
        # Uploads are capped at 64 MiB; download in chunks without buffering the CSV.
        body = None
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=self.key(key))
            body = response["Body"]
            if response.get("ContentLength", 0) > limit:
                raise StorageUnavailable("Stored file exceeds its limit")
            total = 0
            with Path(path).open("xb") as target:
                while chunk := body.read(1024 * 1024):
                    total += len(chunk)
                    if total > limit:
                        raise StorageUnavailable("Stored file exceeds its limit")
                    target.write(chunk)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {
                "NoSuchKey",
                "404",
                "NotFound",
            }:
                raise FileNotFoundError("Stored file unavailable") from None
            raise StorageUnavailable("File storage unavailable") from None
        except (BotoCoreError, OSError):
            raise StorageUnavailable("File storage unavailable") from None
        finally:
            if body is not None:
                body.close()

    def delete_prefix(self, prefix):
        prefix = self.key(prefix).rstrip("/") + "/"
        try:
            pages = self.client.get_paginator("list_objects_v2").paginate(
                Bucket=self.bucket, Prefix=prefix
            )
            for page in pages:
                objects = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
                if objects:
                    response = self.client.delete_objects(
                        Bucket=self.bucket, Delete={"Objects": objects, "Quiet": True}
                    )
                    if response.get("Errors"):
                        raise StorageUnavailable(
                            "Some stored files could not be removed"
                        )
        except (BotoCoreError, ClientError):
            raise StorageUnavailable("File storage unavailable") from None


@lru_cache(maxsize=4)
def _r2(endpoint, bucket, access_key, secret_key, prefix):
    import boto3

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name="auto",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(
            connect_timeout=5,
            read_timeout=30,
            retries={"mode": "standard", "total_max_attempts": 2},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )
    return R2Storage(client, bucket, prefix)


def object_storage(settings):
    if settings.file_storage_backend == "local":
        return None
    return _r2(
        settings.r2_endpoint_url,
        settings.r2_bucket_name,
        settings.r2_access_key_id.get_secret_value(),
        settings.r2_secret_access_key.get_secret_value(),
        settings.r2_prefix,
    )
