from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from qdrant_client import AsyncQdrantClient
from app.db.qdrant_client import get_qdrant_client
from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/chat", tags=["Chat"])

class ChatRequest(BaseModel):
    query: str

class ChatResponse(BaseModel):
    answer: str
    sources: list[dict]

async def get_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        temperature=0.3,
        api_key=settings.GOOGLE_API_KEY,
    )

async def get_embeddings():
    return GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-001",
        google_api_key=settings.GOOGLE_API_KEY
    )

@router.post("/", response_model=ChatResponse)
async def chat_with_brain(
    request: ChatRequest,
    qdrant: AsyncQdrantClient = Depends(get_qdrant_client),
    llm: ChatGoogleGenerativeAI = Depends(get_llm),
    embeddings: GoogleGenerativeAIEmbeddings = Depends(get_embeddings)
):
    """Kullanıcının Zihin Haritasındaki bilgilerine dayanarak cevap verir (RAG)."""
    try:
        # 1. Kullanici sorgusunu vektore cevir
        query_vector = await embeddings.aembed_query(request.query)

        # 2. Qdrant'ta benzer belgeleri ara (Top 3)
        search_result = await qdrant.search(
            collection_name=settings.QDRANT_COLLECTION_NAME,
            query_vector=query_vector,
            limit=3
        )

        if not search_result:
            return ChatResponse(
                answer="Hafızamda bu konuyla ilgili bir bilgi bulamadım. Belki bu konu hakkında yeni kaynaklar eklemelisin!",
                sources=[]
            )

        # 3. Bulunan baglamlari (context) birlestir
        contexts = []
        sources = []
        for scored_point in search_result:
            payload = scored_point.payload
            contexts.append(f"Kaynak: {payload.get('platform')}\nİçerik: {payload.get('text')}")
            sources.append({
                "platform": payload.get("platform"),
                "concepts": payload.get("concepts", []),
                "score": scored_point.score
            })
            
        context_text = "\n\n---\n\n".join(contexts)

        # 4. LLM'e Prompt gonder
        prompt = f"""Sen kullanıcının kişisel öğrenme asistanı ve 'İkinci Beyni'sin.
Kullanıcı sana kendi zihin haritasındaki bilgileri soruyor.
Aşağıdaki 'Bağlam' kısmında, kullanıcının geçmişte öğrendiği kaynaklar var.
SADECE bu bağlamdaki bilgileri kullanarak kullanıcının sorusuna samimi ve net bir dille cevap ver.
Eğer cevap bağlamda yoksa, 'Bunu henüz öğrenmedik, zihin haritanda bu bilgi yok' de.

Bağlam:
{context_text}

Kullanıcının Sorusu: {request.query}

Cevabın:"""

        response = await llm.ainvoke(prompt)

        return ChatResponse(
            answer=response.content,
            sources=sources
        )

    except Exception as e:
        logger.error(f"[Chat] RAG Hatasi: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Sohbet isleminde bir hata olustu.")
