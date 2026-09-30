import base64
import binascii
import os
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import SecretStr


class CredentialStorageUnavailable(Exception):
    pass


class CredentialCipher:
    """Versioned AES-GCM ciphertext bound to its project, connection, and endpoint.

    Keep the persistent key outside PostgreSQL. Changing it requires re-encrypting
    existing credentials; never generate a replacement silently at startup.
    """

    def __init__(self, key: SecretStr | None):
        self._cipher = None
        if key:
            try:
                decoded = base64.b64decode(
                    key.get_secret_value(), altchars=b"-_", validate=True
                )
                if len(decoded) != 32:
                    raise ValueError
                self._cipher = AESGCM(decoded)
            except (ValueError, binascii.Error):
                raise ValueError(
                    "MCP credential key must encode exactly 32 random bytes"
                ) from None

    @staticmethod
    def context(project_id: UUID, server_id: UUID, endpoint: str) -> bytes:
        return f"mcp-v1:{project_id}:{server_id}:{endpoint}".encode()

    def encrypt(
        self, credential: SecretStr, project_id: UUID, server_id: UUID, endpoint: str
    ) -> bytes:
        if self._cipher is None:
            raise CredentialStorageUnavailable
        nonce = os.urandom(12)
        return (
            b"\x01"
            + nonce
            + self._cipher.encrypt(
                nonce,
                credential.get_secret_value().encode(),
                self.context(project_id, server_id, endpoint),
            )
        )

    def decrypt(
        self, encrypted: bytes, project_id: UUID, server_id: UUID, endpoint: str
    ) -> SecretStr:
        if self._cipher is None or len(encrypted) < 30 or encrypted[0] != 1:
            raise CredentialStorageUnavailable
        try:
            return SecretStr(
                self._cipher.decrypt(
                    encrypted[1:13],
                    encrypted[13:],
                    self.context(project_id, server_id, endpoint),
                ).decode()
            )
        except (InvalidTag, UnicodeError, ValueError):
            raise CredentialStorageUnavailable from None
