from sentence_transformers import SentenceTransformer
import psycopg2

# Configuración de conexión a Supabase
DB_CONFIG = {
    "dbname": "postgres",
    "user": "postgres.xxlhqtdmmwbwxqsulpcd",
    "password": "CaliAndo123*",
    "host": "aws-0-us-east-2.pooler.supabase.com",
    "port": "6543"
}

# Cargar modelo de embeddings local
model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')

# Obtener input del usuario
consulta = input("🗣 ¿Qué estás buscando?: ")
embedding = model.encode(consulta).tolist()

try:
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    # Búsqueda con CAST del embedding como vector
    cur.execute("""
        SELECT nombre, descripcion, fuente, referencia_id,
               1 - (embedding <#> CAST(%s AS vector)) AS similarity
        FROM embeddings_index
        ORDER BY embedding <#> CAST(%s AS vector)
        LIMIT 5;
    """, (embedding, embedding))

    resultados = cur.fetchall()

    print("\n🔍 Resultados similares:\n")
    for idx, row in enumerate(resultados, 1):
        print(f"{idx}. {row[0]}\n📝 {row[1]}\n📚 Fuente: {row[2]} | ID: {row[3]}\n")

    cur.close()
    conn.close()

except Exception as e:
    print("❌ Error al conectar o consultar la base de datos:", e)
