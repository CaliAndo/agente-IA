import pdfplumber
import json

pdf_path = 'scraper-pdf/Guia-general-Visit-Valle-2024-2025.pdf'
output_path = 'data/eventos_valle_2024_2025.json'

eventos = []

with pdfplumber.open(pdf_path) as pdf:
    for i in range(60, 70):  # Páginas 61-70 (0-indexed)
        page = pdf.pages[i]
        text = page.extract_text()

        # Aquí puedes aplicar tu lógica personalizada para separar eventos
        # Por ahora simplemente guardamos el texto plano
        eventos.append({
            "pagina": i + 1,
            "contenido": text.strip()
        })

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(eventos, f, ensure_ascii=False, indent=2)

print("✅ Eventos exportados a", output_path)
