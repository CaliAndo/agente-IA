from .db import get_connection

def buscar_coincidencia(embedding, top_k=1):
    try:
        print("🔍 Iniciando búsqueda...")
        vector_str = f"[{', '.join(map(str, embedding))}]"
        print("➞ Vector:", vector_str[:80] + "...")

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT nombre, descripcion, fuente, referencia_id
                    FROM embeddings_index_384
                    ORDER BY embedding <#> %s::vector
                    LIMIT %s
                """, (vector_str, top_k))
                resultados = cur.fetchall()
                print("✅ Resultados:", resultados)
                return resultados
    except Exception as e:
        import traceback
        print("❌ Error en buscar_coincidencia:")
        traceback.print_exc()
        return []
