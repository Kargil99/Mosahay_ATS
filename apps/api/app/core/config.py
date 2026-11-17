from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    mongodb_uri: str = ""
    mongodb_database: str = "mosahay_recruitos"
    jwt_secret: str = ""
    jwt_issuer: str = "mosahay-recruitos"
    jwt_ttl_hours: int = 12
    app_web_url: str = "http://localhost:3000"
    api_public_url: str = "http://localhost:8000"
    auth_cookie_domain: str = ""
    allow_public_signup: bool = True
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/google/callback"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    public_careers_org_id: str = ""
    public_employer_leads_org_id: str = ""
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    max_upload_mb: int = 10
    max_files_per_batch: int = 20
    openai_api_key: str = ""
    openai_model: str = ""
    openai_image_model: str = "gpt-image-2.5-flare"
    ai_scoring_enabled: bool = False
    api_rate_limit_per_minute: int = 60
    public_apply_rate_limit_per_minute: int = 5

    @staticmethod
    def _configured(value: str) -> bool:
        normalized = value.strip().lower()
        return bool(normalized) and not normalized.startswith(("your_", "replace_with_", "<"))

    @property
    def jwt_secret_ready(self) -> bool:
        return len(self.jwt_secret) >= 32 and self._configured(self.jwt_secret)

    @property
    def google_oauth_ready(self) -> bool:
        return self._configured(self.google_client_id) and self._configured(self.google_client_secret)

    @property
    def openai_key_ready(self) -> bool:
        return self._configured(self.openai_api_key)

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
