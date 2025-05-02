from db import get_connection
from embedding import generar_embedding

def insertar(texto: str, fuente: str = "local_script", nombre: str = "Generado localmente", referencia_id=None):
    embedding = generar_embedding(texto)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO embeddings_index (nombre, descripcion, fuente, referencia_id, embedding)
                VALUES (%s, %s, %s, %s, %s)
            """, (nombre, texto, fuente, referencia_id, embedding))
            print(f"✅ Embedding insertado: {texto}")

if __name__ == "__main__":
    insertar("quiero bailar salsa")
