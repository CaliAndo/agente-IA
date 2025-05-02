import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

conn = psycopg2.connect(os.getenv("DATABASE_URL"))
cur = conn.cursor()

try:
    cur.execute("""
        ALTER TABLE embeddings_index
        ALTER COLUMN embedding TYPE vector(384);
    """)
    conn.commit()
    print("✅ Columna 'embedding' actualizada a vector(384)")
except Exception as e:
    print("❌ Error:", e)
finally:
    cur.close()
    conn.close()
