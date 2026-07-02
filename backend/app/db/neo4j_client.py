from neo4j import AsyncGraphDatabase, AsyncDriver
from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
logger = get_logger(__name__)

_driver: AsyncDriver | None = None


async def get_neo4j_driver() -> AsyncDriver:
    """
    Neo4j async driver'ını başlatır ve döner.
    Singleton pattern: Her çağrıda yeni bağlantı açmaz.
    """
    global _driver
    if _driver is None:
        logger.info(f"[NEO4J] Baglanti kuruluyor: {settings.NEO4J_URI}")
        _driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            max_connection_pool_size=20,
        )
        # Bağlantıyı doğrula
        await _driver.verify_connectivity()
        logger.info("[NEO4J] Baglanti basariyla kuruldu.")
    return _driver


async def close_neo4j_driver():
    """Uygulama kapanırken driver'ı kapat."""
    global _driver
    if _driver:
        await _driver.close()
        _driver = None
        logger.info("[NEO4J] Baglanti kapatildi.")


async def create_constraints(driver: AsyncDriver):
    """
    Sprint 1'de kullanılacak temel Node kısıtlamalarını (UNIQUE index) oluşturur.
    Neo4j şeması:
      (User {id}) -[STUDIED {timestamp, duration}]-> (Concept {name, topic})
      (Concept)   -[RELATED_TO {weight}]->           (Concept)
    """
    async with driver.session() as session:
        await session.run(
            "CREATE CONSTRAINT user_id_unique IF NOT EXISTS "
            "FOR (u:User) REQUIRE u.id IS UNIQUE"
        )
        await session.run(
            "CREATE CONSTRAINT concept_name_unique IF NOT EXISTS "
            "FOR (c:Concept) REQUIRE c.name IS UNIQUE"
        )
        logger.info("[NEO4J] Kisitlamalar (constraints) olusturuldu.")
