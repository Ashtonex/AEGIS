from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "Project Imperium - AEGIS Core"
    API_V1_STR: str = "/api/v1"
    
    # Supabase / Database
    DATABASE_URL: str
    SUPABASE_URL: str
    SUPABASE_KEY: str
    
    # JWT
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()
