from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SceneSense AI"
    model_provider: str = "openrouter"  # openrouter | hf_api | transformers
    model_id: str = "openrouter/free"
    openrouter_api_key: str | None = None
    hf_token: str | None = None
    max_upload_mb: int = 10
    max_image_side: int = 1280
    model_device: str = "auto"  # auto | cpu | cuda

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
