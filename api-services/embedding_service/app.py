import os
import logging
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from .embedding import generar_embedding
from .db import get_connection
from .buscar import buscar_coincidencia

# logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("embedding_service")

app = FastAPI()

# Health-check (Railway pings here)
@app.get("/", include_in_schema=False)
async def healthcheck():
    return JSONResponse(status_code=200, content={"status": "ok"})

# Tu modelo de entrada
class TextoEntrada(BaseModel):
    texto: str
    fuente: str = "api"
    nombre: str = "Embedding API"
    referencia_id: int | None = None

@app.on_event("startup")
async def on_startup():
    logger.info("🌱 Embedding-service arrancando…")

@app.post("/generar-embedding")
async def generar_y_guardar(data: TextoEntrada):
    texto = data.texto.strip()
    embedding = generar_embedding(texto)
    if not embedding:
        return {"ok": False, "error": "No se pudo generar el embedding."}
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                vector_str = f"[{', '.join(map(str, embedding))}]"
                cur.execute(
                    """
                    INSERT INTO embeddings_index_384 
                    (nombre, descripcion, fuente, referencia_id, embedding)
                    VALUES (%s,%s,%s,%s,%s::vector)
                    """,
                    (data.nombre, texto, data.fuente, data.referencia_id, vector_str)
                )
                conn.commit()
        return {"ok": True, "descripcion": texto}
    except Exception as e:
        logger.exception("🚨 Error al insertar embedding")
        return {"ok": False, "error": str(e)}

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
        return {"ok": True, "resultados": lista}
    except Exception as e:
        logger.exception("🚨 Error interno en buscar-coincidencia")
        return {"ok": False, "error": f"Error interno: {e}"}
