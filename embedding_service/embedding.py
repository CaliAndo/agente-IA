from sentence_transformers import SentenceTransformer

# Modelo que genera vectores de 384 dimensiones
model = SentenceTransformer('all-MiniLM-L6-v2')

def generar_embedding(texto: str) -> list:
    return model.encode(texto).tolist()
