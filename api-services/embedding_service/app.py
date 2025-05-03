from fastapi import FastAPI
from pydantic import BaseModel
from .embedding import generar_embedding
from .db import get_connection
from .buscar import buscar_coincidencia

app = FastAPI()

class TextoEntrada(BaseModel):
    texto: str
    fuente: str = "api"
    nombre: str = "Embedding API"
    referencia_id: int | None = None

@app.post("/generar-embedding")
async def generar_y_guardar(data: TextoEntrada):
    texto = data.texto.strip()
    embedding = generar_embedding(texto)

    if not embedding:
        return {"ok": False, "error": "No se pudo generar el embedding."}

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                vector_str = f"[{', '.join(map(str, embedding))}]"  # ✅ Formato correcto para pgvector
                cur.execute("""
                    INSERT INTO embeddings_index_384 (nombre, descripcion, fuente, referencia_id, embedding)
                    VALUES (%s, %s, %s, %s, %s::vector)
                """, (
                    data.nombre,
                    texto,
                    data.fuente,
                    data.referencia_id,
                    vector_str
                ))
                conn.commit()  # ✅ Importante para guardar los cambios
        return {"ok": True, "descripcion": texto}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}

@app.get("/")
def home():
    return {"message": "API de embeddings activa 🚀"}

@app.post("/buscar-coincidencia")
async def buscar(data: TextoEntrada):
    try:
        texto = data.texto.strip()
        embedding = generar_embedding(texto)

        if not embedding:
            return {"ok": False, "error": "No se pudo generar el embedding."}

        resultados = buscar_coincidencia(embedding, top_k=10)

        if not resultados:
            return {"ok": False, "mensaje": "No se encontró ninguna coincidencia."}

        lista = [
            {
                "nombre": row[0],
                "descripcion": row[1],
                "fuente": row[2],
                "referencia_id": row[3]
            }
            for row in resultados
        ]

        return {
            "ok": True,
            "resultados": lista
        }

    except Exception as e:
        import traceback
        traceback.print_exc()  # 👈 imprime el error real en Railway Logs
        return {"ok": False, "error": f"Error interno: {str(e)}"}
