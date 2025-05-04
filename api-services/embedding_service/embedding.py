from sentence_transformers import SentenceTransformer

_model = None  # cache del modelo

def get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer('all-MiniLM-L6-v2')
    return _model

def generar_embedding(texto: str) -> list:
    model = get_model()
    return model.encode(texto).tolist()
