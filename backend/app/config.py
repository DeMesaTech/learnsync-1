from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    app_env: str = "development"
    app_origin: str = "http://127.0.0.1:5173"
    app_timezone: str = "Asia/Manila"
    database_url: str
    test_database_url: str = ""
    session_cookie_name: str = "learnsync_v2_session"
    session_cookie_secure: bool = False
    session_max_age_seconds: int = 43200
    session_idle_timeout_seconds: int = 1800
    invitation_ttl_seconds: int = 172800
    reset_ttl_seconds: int = 1800
    smtp_host: str = "127.0.0.1"
    smtp_port: int = 11025
    smtp_use_tls: bool = False
    smtp_username: str = ""
    smtp_password: str = ""
    mail_from: str = "learnsync@example.test"
    upload_root: Path = ROOT / "var" / "uploads"
    upload_max_bytes: int = 20971520
    groq_api_key: str = ""
    groq_chat_model: str = "openai/gpt-oss-20b"
    groq_quiz_model: str = "openai/gpt-oss-20b"
    ai_timeout_seconds: int = 45
    ai_provider_mode: str = "groq"        # "fake" is a development-only simulator
    ai_messages_per_minute: int = 10

@lru_cache
def settings():
    return Settings()
