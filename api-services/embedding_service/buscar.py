from .db import get_connection

def buscar_coincidencia(embedding, top_k=1):
    vector_str = f"[{', '.join(map(str, embedding))}]"

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT nombre, descripcion, fuente, referencia_id
                FROM embeddings_index_384
                ORDER BY embedding <#> %s::vector
                LIMIT %s
            """, (vector_str, top_k))
            return cur.fetchall()
