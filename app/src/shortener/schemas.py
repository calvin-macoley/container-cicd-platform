"""Request and response models."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import AnyUrl, AwareDatetime, BaseModel, ConfigDict, StringConstraints, UrlConstraints

from shortener.services.links import ALIAS_PATTERN

MAX_URL_LENGTH = 2048

TargetUrl = Annotated[
    AnyUrl,
    UrlConstraints(
        max_length=MAX_URL_LENGTH, allowed_schemes=["http", "https"], host_required=True
    ),
]
Alias = Annotated[str, StringConstraints(pattern=ALIAS_PATTERN)]


class HealthResponse(BaseModel):
    status: str


class VersionResponse(BaseModel):
    version: str
    git_sha: str
    environment: str


class LinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: TargetUrl
    alias: Alias | None = None
    expires_at: AwareDatetime | None = None


class LinkResponse(BaseModel):
    code: str
    short_url: str
    target_url: str
    created_at: datetime
    expires_at: datetime | None
    is_expired: bool
    click_count: int
    last_clicked_at: datetime | None
