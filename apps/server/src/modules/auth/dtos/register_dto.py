from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=1024)
    display_name: str | None = Field(default=None, max_length=160)
    invitation_code: str | None = None
