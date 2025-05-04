from embedding_service.app import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("embedding_service.app:app", host="0.0.0.0", port=8000, reload=False)
