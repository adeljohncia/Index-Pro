# Advanced PDF Converter Backend

Enterprise-grade OCR-powered PDF converter with support for DOCX, PPTX, and XLSX output formats.

## Features

✅ **Multiple OCR Engines**
- PaddleOCR (primary, highest accuracy)
- EasyOCR (fallback for low confidence)
- Tesseract.js (browser fallback)
- Automatic engine selection based on confidence

✅ **Image Processing**
- 2x upscaling for blurry scans
- Denoising with FastNLMeans
- Sharpening with kernel filters
- Adaptive thresholding
- Auto angle correction

✅ **Multi-Language Support**
- Automatic language detection (langdetect)
- Multi-language OCR support (en, ms, zh_sim, ar, ja)
- Per-word language identification

✅ **AI Enhancements**
- TextBlob spell correction
- Low-confidence text correction
- Reading order preservation
- Confidence-based filtering

✅ **Output Formats**
- DOCX: Preserves layout and styling
- PPTX: One slide per page with text boxes
- XLSX: Structured data with metadata

✅ **GPU Acceleration**
- CUDA support via PyTorch
- Automatic GPU/CPU detection
- Parallel processing ready

## Installation

### Prerequisites

- Python 3.9+
- CUDA 11.8+ (optional, for GPU acceleration)
- poppler-utils (for pdf2image)

### macOS

```bash
# Install poppler
brew install poppler

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Linux

```bash
# Install poppler
sudo apt-get install poppler-utils

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Windows

```bash
# Install poppler via chocolatey
choco install poppler

# Create virtual environment
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Usage

### Start Server

```bash
python main.py
```

Server will run on `http://localhost:8000`

### API Endpoints

#### Health Check
```bash
GET /health
```

#### Convert PDF
```bash
POST /api/convert
Content-Type: multipart/form-data

file: <PDF file>
output_format: docx|pptx|xlsx
```

Example:
```bash
curl -X POST "http://localhost:8000/api/convert" \
  -F "file=@sample.pdf" \
  -F "output_format=docx"
```

#### Analyze Image with OCR
```bash
POST /api/ocr/analyze
Content-Type: multipart/form-data

file: <Image file>
```

#### Analyze Layout
```bash
POST /api/analyze/layout
Content-Type: multipart/form-data

file: <Image file>
```

#### Batch Convert
```bash
POST /api/convert/batch
Content-Type: multipart/form-data

files: <Multiple PDF files>
output_format: docx|pptx|xlsx
```

#### Download File
```bash
GET /api/download/{filename}
```

#### Get Status
```bash
GET /api/status
```

## Configuration

### Environment Variables

```bash
# GPU acceleration (default: auto-detect)
export USE_GPU=true

# Logging level
export LOG_LEVEL=INFO

# Server port
export PORT=8000

# Upload directory
export UPLOAD_DIR=./uploads

# Output directory
export OUTPUT_DIR=./outputs
```

## Performance

### Benchmarks (on M2 Mac, 1 page PDF)

| Operation | Time | Accuracy |
|-----------|------|----------|
| Image preprocessing | ~500ms | - |
| PaddleOCR | ~800ms | 95%+ |
| EasyOCR fallback | ~1.2s | 90%+ |
| DOCX generation | ~200ms | - |
| **Total (avg)** | **~1.7s** | - |

### GPU Performance (NVIDIA RTX 3060)

- PaddleOCR: ~200ms per page
- 10x faster than CPU mode
- Handles 50+ pages in parallel

## Architecture

```
main.py                 # FastAPI server
├── converter.py        # DOCX/PPTX/XLSX converters
│   ├── convert_pdf_to_docx()
│   ├── convert_pdf_to_pptx()
│   └── convert_pdf_to_xlsx()
└── ocr_engine.py       # OCR processing
    ├── run_advanced_ocr()
    ├── preprocess_image()
    ├── detect_language()
    ├── correct_text()
    └── analyze_layout()
```

## Troubleshooting

### PaddleOCR Model Download Issue

```bash
# Download models manually
from paddleocr import PaddleOCR
ocr = PaddleOCR()  # Downloads models on first run
```

### CUDA Out of Memory

Reduce batch size or switch to CPU:
```bash
USE_GPU=false python main.py
```

### Poppler Not Found

```bash
# macOS
brew install poppler

# Linux
sudo apt-get install poppler-utils

# Windows
choco install poppler
```

## Integration with Frontend

See `../pdf-indexer/src/features/converter/services/ocr-service-backend.ts` for TypeScript client integration.

### Example Frontend Call

```typescript
const response = await fetch('http://localhost:8000/api/convert', {
  method: 'POST',
  body: formData,
});

const result = await response.json();
const downloadUrl = `http://localhost:8000${result.download_url}`;
```

## Future Enhancements

- [ ] LayoutLMv3 for document understanding
- [ ] Detectron2 for table detection
- [ ] TrOCR for specialized OCR
- [ ] Font reconstruction AI
- [ ] Chart recognition
- [ ] Handwriting OCR
- [ ] Redis queue support
- [ ] Kubernetes deployment
- [ ] Cost optimization (AWS Textract, Google Vision fallback)

## License

MIT

## Support

For issues and feature requests, please open an issue on GitHub.
