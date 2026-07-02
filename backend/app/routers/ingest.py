from fastapi import APIRouter, Depends, HTTPException, status
from app.models.schemas import IngestRequest, IngestResponse
from app.services.ingest_service import IngestService
from app.db.neo4j_client import get_neo4j_driver
from app.db.qdrant_client import get_qdrant_client
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/api/v1", tags=["Ingest"])


async def get_ingest_service() -> IngestService:
    """Dependency Injection: Servis ve DB bağlantılarını birleştirir."""
    neo4j = await get_neo4j_driver()
    qdrant = await get_qdrant_client()
    return IngestService(neo4j_driver=neo4j, qdrant_client=qdrant)


@router.post(
    "/ingest",
    response_model=IngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Chrome Extension'dan gelen veriyi işle",
    description=(
        "n8n veya doğrudan Chrome Extension'dan gelen ham soru-cevap verisini alır, "
        "PII kontrolü yapılmış olarak Neo4j'e RawSession olarak kaydeder."
    ),
)
async def ingest_data(
    request: IngestRequest,
    service: IngestService = Depends(get_ingest_service),
) -> IngestResponse:
    try:
        result = await service.process(request)
        return IngestResponse(**result)
    except Exception as e:
        logger.error(f"[/ingest] İşlem hatası: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Veri işlenirken bir hata oluştu.",
        )
