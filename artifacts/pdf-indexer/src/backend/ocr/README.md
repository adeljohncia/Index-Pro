# OCR Backend Hook

The current converter runs in browser mode so the app can publish on GitHub
Pages. For production OCR, connect these service boundaries to a FastAPI or
Node/Python worker service:

- `POST /api/converter/upload`
- `POST /api/converter/ocr`
- `GET /api/converter/status/:jobId`
- `GET /api/converter/download/:jobId`

Recommended engines: Tesseract, PaddleOCR, EasyOCR, Azure OCR, or Google Vision.
Queue long documents with Redis and stream page progress over WebSocket.
