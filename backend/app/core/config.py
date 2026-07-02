from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Uygulama
    APP_NAME: str = "LearnSphere AI Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Neo4j
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "learnsphere"

    # Qdrant
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333
    QDRANT_COLLECTION_NAME: str = "learnsphere_concepts"

    # Embedding
    # AI API Keys
    GOOGLE_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
