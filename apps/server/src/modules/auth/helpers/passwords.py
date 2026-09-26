from argon2 import PasswordHasher
from argon2.exceptions import VerificationError


class Argon2idPasswordHasher:
    def __init__(self) -> None:
        self._hasher = PasswordHasher(memory_cost=19_456, time_cost=2, parallelism=1)

    def hash(self, password: str) -> str:
        return self._hasher.hash(password)

    def verify(self, password: str, encoded_hash: str) -> bool:
        try:
            return self._hasher.verify(encoded_hash, password)
        except VerificationError:
            return False
