import os
import psycopg2
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

# Cargar variables del entorno
load_dotenv()

# Configurar modelo
modelo = SentenceTransformer("all-MiniLM-L6-v2")

# Conectar a la base de datos
conn = psycopg2.connect(os.getenv("DATABASE_URL"))
cur = conn.cursor()

# Traer eventos
cur.execute("SELECT id, nombre, descripcion FROM eventos")
eventos = cur.fetchall()

print(f"🎯 Total de eventos encontrados: {len(eventos)}")

# Insertar embeddings
for id_, nombre, descripcion in eventos:
    texto = f"{nombre or ''}. {descripcion or ''}".strip()
    if not texto:
        continue

    embedding = modelo.encode(texto).tolist()
    vector_str = f"[{', '.join(map(str, embedding))}]"

    cur.execute("""
        INSERT INTO embeddings_index_384 (nombre, descripcion, fuente, referencia_id, embedding)
        VALUES (%s, %s, %s, %s, %s::vector)
    """, (nombre, descripcion, "eventos", id_, vector_str))

    print(f"✅ Insertado: {nombre}")

# Confirmar cambios
conn.commit()
cur.close()
conn.close()

print("🚀 Todos los embeddings fueron insertados con éxito.")
