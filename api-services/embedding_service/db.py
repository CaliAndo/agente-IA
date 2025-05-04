import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()  # Carga las variables desde el .env

def get_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"))