# Backend OCR Integration Guide

This document explains how to set up and use the advanced Python-based OCR backend with the PDF Converter application.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  PDF Converter Frontend (React/TypeScript)              │
│  - Browser-based OCR fallback                           │
│  - Layout analysis                                      │
│  - Document export (DOCX/PPTX/XLSX)                    │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP API
                     ↓
┌─────────────────────────────────────────────────────────┐
│  FastAPI Backend Service (Python)                       │
│  - PaddleOCR (primary, highest accuracy)               │
│  - EasyOCR (fallback engine)                           │
│  - Advanced image preprocessing                         │
│  - Multi-language detection                             │
│  - GPU acceleration (CUDA)                              │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Start Python Backend

```bash
cd artifacts/pdf-converter-py

# Install dependencies
pip install -r requirements.txt

# Run server
python main.py

# Server runs on http://localhost:8000
```

### 2. Configure Frontend

Add to `.env` or `.env.local`:

```bash
VITE_BACKEND_URL=http://localhost:8000
VITE_BACKEND_OCR_ENABLED=true
```

### 3. Run Frontend

```bash
cd artifacts/pdf-indexer
pnpm dev
```

## Backend API Endpoints

### Health Check
```bash
GET /health

Response:
{
  "status": "healthy",
  "service": "PDF Converter API",
  "version": "1.0.0"
}
```

### Convert PDF
```bash
POST /api/convert
Content-Type: multipart/form-data

file: <PDF file>
output_format: docx|pptx|xlsx

Response:
{
  "success": true,
  "input_file": "sample.pdf",
  "output_file": "sample.docx",
  "download_url": "/api/download/sample.docx"
}
```

### Analyze OCR Results
```bash
POST /api/ocr/analyze
Content-Type: multipart/form-data

file: <Image file>

Response:
{
  "success": true,
  "filename": "page_1.png",
  "text_elements": 142,
  "data": [
    {
      "text": "Sample Text",
      "confidence": 0.95,
      "language": "en",
      "x": 100,
      "y": 200,
      "coordinates": [[100,200], [200,200], [200,300], [100,300]]
    },
    ...
  ]
}
```

### Analyze Layout
```bash
POST /api/analyze/layout
Content-Type: multipart/form-data

file: <Image file>

Response:
{
  "success": true,
  "filename": "page_1.png",
  "page_size": {"width": 2400, "height": 3200},
  "layout": {
    "columns": 2,
    "column_boundaries": [0, 1200, 2400],
    "avg_confidence": 0.92
  }
}
```

### Download File
```bash
GET /api/download/sample.docx

Returns: File stream
```

### Batch Convert
```bash
POST /api/convert/batch
Content-Type: multipart/form-data

files: <Multiple PDF files>
output_format: docx|pptx|xlsx

Response:
{
  "success": true,
  "total_files": 3,
  "results": [
    {
      "input_file": "file1.pdf",
      "output_file": "file1.docx",
      "download_url": "/api/download/file1.docx"
    },
    ...
  ]
}
```

## Frontend Configuration

### Environment Variables

Create `.env.local` in `artifacts/pdf-indexer/`:

```bash
# Backend service URL
VITE_BACKEND_URL=http://localhost:8000

# Enable backend OCR (true/false)
VITE_BACKEND_OCR_ENABLED=true

# Request timeout in milliseconds
VITE_BACKEND_TIMEOUT=60000

# Default quality level
VITE_DEFAULT_OCR_QUALITY=balanced

# Feature flags
VITE_ENABLE_MULTILANG=true
VITE_ENABLE_LAYOUT_ANALYSIS=true
VITE_ENABLE_TABLE_DETECTION=true
VITE_ENABLE_SPELL_CORRECTION=true
```

### Using Backend OCR in Code

```typescript
import BackendOCRService from '@/features/converter/services/backend-ocr-service';
import { OCR_CONFIG } from '@/features/converter/config/ocr-config';

// Check if backend is available
const backendOCR = new BackendOCRService();
const available = await backendOCR.checkAvailability();

// Convert PDF
if (available) {
  const layout = await backendOCR.convertPDF(file, settings, onProgress);
}

// Analyze image
const results = await backendOCR.analyzeImage(imageFile);

// Analyze layout
const layoutAnalysis = await backendOCR.analyzeLayout(imageFile);

// Get service status
const status = await backendOCR.getStatus();
```

## Deployment

### Docker Deployment

```bash
# Build Docker image
docker build -t pdf-converter-backend .

# Run container
docker run -p 8000:8000 \
  -e USE_GPU=true \
  -e LOG_LEVEL=INFO \
  pdf-converter-backend
```

### Production Setup

1. **Use Gunicorn + Uvicorn:**
```bash
pip install gunicorn
gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app
```

2. **Use Nginx Reverse Proxy:**
```nginx
server {
    listen 80;
    server_name ocr-api.example.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

3. **Configure CORS:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Performance Tuning

### GPU Acceleration

```bash
# Enable GPU (CUDA)
export USE_GPU=true
python main.py

# Check GPU usage
nvidia-smi
```

### Memory Optimization

```bash
# Reduce worker count
WORKERS=2 python main.py

# Enable memory mapping
USE_MEMORY_MAP=true python main.py
```

### Caching

```bash
# Enable Redis caching (future)
export REDIS_URL=redis://localhost:6379
```

## Troubleshooting

### Backend Not Responding

```bash
# Check if backend is running
curl http://localhost:8000/health

# Check logs
tail -f backend.log

# Verify firewall
netstat -an | grep 8000
```

### CUDA Out of Memory

```bash
# Switch to CPU
export USE_GPU=false
python main.py

# Or reduce batch size
export BATCH_SIZE=1
python main.py
```

### Model Download Failure

```bash
# Download models manually
python -c "from paddleocr import PaddleOCR; PaddleOCR()"

# Set custom model directory
export PADDLEOCR_MODEL_DIR=/path/to/models
python main.py
```

## Fallback Behavior

If backend is unavailable:

1. Frontend detects backend connection failure
2. Automatically switches to browser-based OCR
3. Shows notification to user
4. Uses Tesseract.js for text extraction
5. Maintains all functionality (DOCX/PPTX export works)

## Monitoring

### Health Metrics

```bash
# Get service status
curl http://localhost:8000/api/status

# Check conversion queue
curl http://localhost:8000/api/jobs
```

### Logging

Backend logs all operations:

```bash
# View logs
tail -f /tmp/pdf-converter.log

# Change log level
export LOG_LEVEL=DEBUG
```

## Security Considerations

1. **File Upload Limits:**
   - Max file size: 100MB (configurable)
   - Allowed formats: PDF only

2. **Rate Limiting:**
   ```python
   # Add to main.py
   from slowapi import Limiter
   limiter = Limiter(key_func=get_remote_address)
   app.state.limiter = limiter
   ```

3. **Authentication:**
   ```python
   # Add JWT/API key validation
   from fastapi.security import HTTPBearer
   security = HTTPBearer()
   ```

4. **Input Validation:**
   - All files are scanned for malware
   - File type verification
   - Size limits enforced

## Advanced Features

### Custom OCR Models

```bash
# Use custom trained PaddleOCR model
export PADDLEOCR_MODEL_PATH=/path/to/model.pth
python main.py
```

### Language Packs

```python
# Add additional languages to EasyOCR
easy_reader = easyocr.Reader([
    'en', 'ms', 'ch_sim', 'ar', 'ja',
    'ko', 'fr', 'de', 'es'  # Add more
])
```

### Custom Post-Processing

```python
# Add custom text correction
def custom_postprocess(text, language):
    # Your logic here
    return corrected_text
```

## Next Steps

1. Set up backend service
2. Configure frontend environment
3. Test with sample PDFs
4. Monitor performance metrics
5. Deploy to production

For more information, see:
- [Backend README](../pdf-converter-py/README.md)
- [Frontend Component Docs](./COMPONENTS.md)
- [API Documentation](./API.md)
