from neo4j import AsyncDriver
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field
from datetime import datetime, timezone

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.fsrs_engine import FSRSEngine
from app.services.graph_service import GraphService

logger = get_logger(__name__)
settings = get_settings()


class SuggestedPrerequisites(BaseModel):
    prerequisites: list[str] = Field(
        description=(
            "Hedef konu icin en kritik 2-4 onkosul kavram, en kritikten en az kritige siralanmis. "
            "Kullanicinin mevcut kavram listesinde ayni/esdeger bir kavram varsa MUTLAKA o listedeki "
            "ismi birebir kullan (yeni isim uydurma)."
        )
    )


PREREQUISITE_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        """Sen bir öğrenme asistanının "önkoşul kavram" uzmanısın. Kullanıcı yeni bir konu öğrenmek
istiyor; görevin bu konu için gerçekten gerekli olan 2-4 temel önkoşul kavramı belirlemek.

KURALLAR:
- Sadece gerçekten teknik/eğitimsel önkoşulları listele, çok genel veya alakasız kavram ekleme.
- ÇOK ÖNEMLİ (ENTITY RESOLUTION): Sana "Mevcut Kavram Listesi" adında, kullanıcının kendi haritasında
  zaten var olan kavramların isimlerini vereceğiz. Eğer önerdiğin bir önkoşul bu listedeki bir kavramla
  AYNI anlama geliyorsa (farklı dilde/yazımda olsa bile), KESİNLİKLE listede gördüğün o ismi kullan!
  Asla yeni (duplicate) bir isim üretme.
- Eşleşen kavram yoksa, konunun en yaygın bilinen (genellikle İngilizce) adını kullan.
- En kritik önkoşuldan en az kritik olana doğru sırala.

Yanıtını SADECE aşağıdaki JSON formatında ver, başka hiçbir şey yazma:
{{
  "prerequisites": ["onkosul_1", "onkosul_2"]
}}""",
    ),
    (
        "human",
        "Hedef Konu: {goal}\n\nMevcut Kavram Listesi (varsa bunlardan kullan): {existing_concepts}",
    ),
])


class LearningGoalService:
    """
    "Öğrenme Yolu" özelliğinin 2. aşaması: kullanıcı haritada hiç olmayan, henüz hiç
    çalışılmamış bir hedef girdiğinde (örn. "Büyük Dil Modelleri (LLM)"), bu konunun
    önkoşullarını (genel bilgiden, LLM ile) bulur ve kullanıcının KENDİ haritasındaki
    karşılıklarının sağlık durumunu (gerçek Neo4j verisiyle) kontrol eder.

    Önemli: LLM sadece "bu konunun önkoşulları nedir" sorusu için kullanılır. Sağlık
    durumu tespiti ve nihai Türkçe açıklama tamamen deterministik Python ile üretilir.
    Hedef ve önkoşullar asla Concept node'u olarak yazılmaz (GraphService'in Concept
    semantiği bozulmasın diye) — LLM önerisi sadece ayrı bir :GoalSuggestion node'unda
    önbelleğe alınır.
    """

    def __init__(self, neo4j_driver: AsyncDriver):
        self.neo4j = neo4j_driver
        self.llm = ChatGoogleGenerativeAI(
            model="gemini-3.5-flash",
            temperature=0.2,
            api_key=settings.GOOGLE_API_KEY,
        )
        self.parser = JsonOutputParser(pydantic_object=SuggestedPrerequisites)
        self.chain = PREREQUISITE_PROMPT | self.llm | self.parser

    async def resolve_goal(self, goal: str) -> dict:
        """
        Hedef metni çözümler. Grafda zaten varsa {"in_graph": True, "target": <isim>}
        döner (router bunu GraphService.get_learning_path'e devreder, LLM çağrısı yok).
        Yoksa LLM ile önkoşulları bulur, kullanıcının haritasıyla karşılaştırır ve
        {"in_graph": False, "target", "prerequisites", "weak_prerequisites", "message"} döner.
        """
        concepts = await self._fetch_concepts_with_p()
        by_name = {c["name"].lower(): c for c in concepts}

        existing = by_name.get(goal.lower())
        if existing:
            return {"in_graph": True, "target": existing["name"]}

        cache_key = goal.lower()
        prereq_names = await self._load_cached_suggestion(cache_key)
        if prereq_names is None:
            prereq_names = await self._ask_llm(goal, existing_names=[c["name"] for c in concepts])
            await self._save_cached_suggestion(cache_key, goal, prereq_names)

        prerequisites = []
        for name in prereq_names:
            match = by_name.get(name.strip().lower())
            if match:
                health = GraphService._classify_health(match["fsrs_p"])
                prerequisites.append({
                    "name": match["name"],
                    "studied": True,
                    "fsrs_p": match["fsrs_p"],
                    "health": health,
                })
            else:
                prerequisites.append({
                    "name": name,
                    "studied": False,
                    "fsrs_p": None,
                    "health": "not_studied",
                })

        weak_prerequisites = [p["name"] for p in prerequisites if p["health"] != "strong"]
        message = self._build_message(goal, prerequisites, weak_prerequisites)

        return {
            "in_graph": False,
            "target": goal,
            "prerequisites": prerequisites,
            "weak_prerequisites": weak_prerequisites,
            "message": message,
        }

    async def _ask_llm(self, goal: str, existing_names: list[str]) -> list[str]:
        try:
            existing_str = ", ".join(existing_names) if existing_names else "Henüz kavram yok"
            result: dict = await self.chain.ainvoke({
                "goal": goal,
                "existing_concepts": existing_str,
            })
            suggestion = SuggestedPrerequisites(**result)
            logger.info(f"[LearningGoal] '{goal}' icin onkosul onerildi: {suggestion.prerequisites}")
            return suggestion.prerequisites
        except Exception as e:
            logger.error(f"[LearningGoal] LLM onkosul hatasi ({goal}): {e}", exc_info=True)
            return []

    @staticmethod
    def _build_message(goal: str, prerequisites: list[dict], weak: list[str]) -> str:
        names = ", ".join(f"'{p['name']}'" for p in prerequisites)
        base = f"'{goal}' öğrenmek için öncelikle {names} kavramlarını bilmelisin."

        if not weak:
            return base + " Bunların hepsi haritanda sağlam görünüyor, doğrudan yeni konuya geçebilirsin."

        details = []
        for p in prerequisites:
            if p["health"] == "not_studied":
                details.append(f"Ancak '{p['name']}' haritanda hiç yok, önce onu öğrenmen gerekiyor.")
            elif p["health"] == "critical":
                pct = round(p["fsrs_p"] * 100) if p["fsrs_p"] is not None else "?"
                details.append(f"Ancak '{p['name']}' düğümü kırmızıya dönmüş (hatırlama %{pct}).")
            elif p["health"] == "warning":
                pct = round(p["fsrs_p"] * 100) if p["fsrs_p"] is not None else "?"
                details.append(f"'{p['name']}' turuncu bölgede (hatırlama %{pct}), tazelemekte fayda var.")

        return base + " " + " ".join(details) + " Önce bunları tazeleyelim, ardından yeni konuya geçiş yapabilirsin."

    async def _fetch_concepts_with_p(self) -> list[dict]:
        """Tum Concept'leri dinamik fsrs_p ile ceker (GraphService._fetch_all_concepts_with_dynamic_p ile ayni mantik, decoupled kopya)."""
        async with self.neo4j.session() as session:
            result = await session.run("""
                MATCH (c:Concept)
                RETURN c.name AS name, c.fsrs_p AS fsrs_p, c.fsrs_s AS stability, c.last_studied AS last_studied
            """)
            records = await result.data()

        now = datetime.now(timezone.utc)
        concepts = []
        for r in records:
            p = r.get("fsrs_p")
            stability = r.get("stability")
            last_studied = r.get("last_studied")
            if stability is not None and last_studied is not None:
                try:
                    studied_dt = last_studied.to_native()
                    if studied_dt.tzinfo is None:
                        studied_dt = studied_dt.replace(tzinfo=timezone.utc)
                    elapsed_days = (now - studied_dt).total_seconds() / (24 * 3600)
                    p = FSRSEngine.calculate_current_retrievability(stability, elapsed_days)
                except Exception:
                    pass
            concepts.append({"name": r["name"], "fsrs_p": round(p, 4) if isinstance(p, (int, float)) else None})
        return concepts

    async def _load_cached_suggestion(self, cache_key: str) -> list[str] | None:
        async with self.neo4j.session() as session:
            result = await session.run(
                "MATCH (g:GoalSuggestion {key: $key}) RETURN g.prerequisites AS prerequisites",
                key=cache_key,
            )
            record = await result.single()
        if record is None:
            return None
        logger.debug(f"[LearningGoal] Onbellekten donduruldu: {cache_key}")
        return list(record["prerequisites"] or [])

    async def _save_cached_suggestion(self, cache_key: str, goal: str, prerequisites: list[str]):
        try:
            async with self.neo4j.session() as session:
                await session.run(
                    """
                    MERGE (g:GoalSuggestion {key: $key})
                    ON CREATE SET g.goal = $goal, g.prerequisites = $prereqs, g.created_at = datetime()
                    """,
                    key=cache_key,
                    goal=goal,
                    prereqs=prerequisites,
                )
        except Exception as e:
            logger.error(f"[LearningGoal] Onbellek yazma hatasi: {e}", exc_info=True)
