from .db import get_connection
import logging

logger = logging.getLogger(__name__)

def buscar_coincidencia(
    embedding: list[float],
    top_k: int = 10,
    max_distance: float | None = None,
    fts_query: str | None = None
) -> list[tuple]:
    """
    Busca coincidencias semánticas en embeddings_index_384.
    Devuelve tuplas: (nombre, descripcion, fuente, referencia_id, distance)
    - max_distance: si se da, filtra resultados con distance > max_distance
    - fts_query: si tras filtrar no hay resultados, hace fallback full-text
    """
    try:
        logger.info("🔍 Iniciando búsqueda semántica...")
        vector_str = f"[{', '.join(map(str, embedding))}]"
        logger.debug("➞ Vector (truncado): %s...", vector_str[:80])

        with get_connection() as conn:
            with conn.cursor() as cur:
                # 1) Semántica con distancia L2
                cur.execute(
                    """
                    SELECT
                      nombre,
                      descripcion,
                      fuente,
                      referencia_id,
                      embedding <-> %s::vector AS distance
                    FROM embeddings_index_384
                    ORDER BY distance
                    LIMIT %s
                    """,
                    (vector_str, top_k)
                )
                resultados = cur.fetchall()

        # 2) Filtrar por umbral de distancia
        if max_distance is not None:
            before = len(resultados)
            resultados = [r for r in resultados if r[4] <= max_distance]
            logger.debug("Filtrado por max_distance=%s: %d→%d", max_distance, before, len(resultados))

        # 3) Fallback a full-text si no hay resultados
        if not resultados and fts_query:
            logger.info("Semántica sin hits; fallback full-text: %r", fts_query)
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT
                          nombre,
                          descripcion,
                          'eventos' AS fuente,
                          id AS referencia_id,
                          NULL::float AS distance
                        FROM eventos
                        WHERE to_tsvector('spanish', nombre || ' ' || descripcion)
                              @@ plainto_tsquery('spanish', %s)
                        LIMIT %s
                        """,
                        (fts_query, top_k)
                    )
                    resultados = cur.fetchall()

        logger.info("✅ Resultados finales (%d): %s", len(resultados), resultados)
        return resultados

    except Exception:
        logger.exception("❌ Error en buscar_coincidencia")
        return []
