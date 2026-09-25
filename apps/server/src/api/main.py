from typing import Literal

import uvicorn
from core.settings import Settings
from fastapi import FastAPI
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


app = FastAPI(title="Agent Tool Experiment Platform", version="0.1.0")


@app.get("/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    """Report process liveness; dependency readiness is added with persistence."""
    return HealthResponse()


def run() -> None:
    settings = Settings()
    uvicorn.run("api.main:app", host=settings.api_host, port=settings.api_port)


if __name__ == "__main__":
    run()
