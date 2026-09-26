from pydantic import BaseModel


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str | None
