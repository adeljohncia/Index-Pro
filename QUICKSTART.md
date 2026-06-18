# Quick Start Guide: Advanced PDF Converter

Get up and running in 5 minutes!

## Prerequisites

- Python 3.9+ with pip
- Node.js 18+ with pnpm
- Poppler utilities

## Installation

### Step 1: Install System Dependencies

**macOS:**
```bash
brew install poppler
```

**Ubuntu/Debian:**
```bash
sudo apt-get install poppler-utils
```

**Windows:**
```bash
choco install poppler
```

### Step 2: Start Python Backend

```bash
cd artifacts/pdf-converter-py

# Install Python packages
pip install -r requirements.txt

# Start server (runs on port 8000)
python main.py

# You should see: "Uvicorn running on http://0.0.0.0:8000"
```

### Step 3: Configure Frontend

```bash
cd artifacts/pdf-indexer

# Create .env.local file
cat > .env.local << 'EOF'
VITE_BACKEND_URL=http://localhost:8000
VITE_BACKEND_OCR_ENABLED=true
VITE_DEFAULT_OCR_QUALITY=maximum
EOF

# Install dependencies (if needed)
pnpm install

# Start frontend (runs on port 23735)
pnpm dev
```

### Step 4: Use the App

1. Open browser: **http://localhost:23735**
2. Upload a PDF file
3. Select quality: **"maximum"** (to use backend)
4. Click **"Convert"**
5. Choose output format: **DOCX**, **PPTX**, or **XLSX**
6. Download converted file!

## Verify Setup

### Check Backend Health
```bash
curl http://localhost:8000/health
# Should return: {"status": "healthy", ...}
```

### Check Backend Status
```bash
curl http://localhost:8000/api/status
# Shows active jobs and conversions
```

## Troubleshooting

### Backend won't start
```bash
# Check Python version
python --version

# Verify pip packages
pip list | grep paddleocr

# Try installing again
pip install -r requirements.txt --upgrade
```

### GPU not detected
```bash
# Check CUDA
python -c "import torch; print(torch.cuda.is_available())"

# If False, disable GPU:
export USE_GPU=false
python main.py
```

### Frontend can't reach backend
```bash
# Verify backend is running
curl http://localhost:8000/health

# Check browser console (F12)
# Look for network errors

# Restart both services
```

### Slow performance
```bash
# Use GPU (if available)
# Check: curl http://localhost:8000/health

# For CPU-only, consider smaller PDFs
# Or set quality to "balanced" instead of "maximum"
```

## Features

✅ **Multi-Language OCR** - English, Malay, Chinese, Arabic, Japanese
✅ **Scanned Document Support** - Auto-enhancement for low-quality scans
✅ **GPU Acceleration** - 10x faster with NVIDIA GPU
✅ **Multiple Output Formats** - DOCX, PPTX, XLSX
✅ **Layout Preservation** - Maintains columns and structure
✅ **Fallback Mode** - Browser OCR if backend unavailable

## Next Steps

1. **Try Different Quality Settings:**
   - `fast` - Quick browser OCR
   - `balanced` - Browser OCR with enhancement
   - `maximum` - Full backend processing

2. **Test Multi-Language:**
   - Upload PDFs in different languages
   - Select "Mixed language" option
   - Backend auto-detects and processes

3. **Monitor Performance:**
   - Check `http://localhost:8000/api/status`
   - View conversion times
   - Monitor GPU usage (if enabled)

4. **Production Setup:**
   - See [BACKEND_INTEGRATION.md](./BACKEND_INTEGRATION.md)
   - For deployment instructions
   - Docker, cloud deployment options

## Common Tasks

### Convert a PDF
```
1. Upload file on web UI
2. Select quality: "maximum"
3. Choose output: "docx"
4. Click "Convert"
5. Download result
```

### Batch Convert Multiple PDFs
```bash
curl -X POST http://localhost:8000/api/convert/batch \
  -F "files=@file1.pdf" \
  -F "files=@file2.pdf" \
  -F "output_format=docx"
```

### Extract OCR Data (JSON)
```bash
curl -X POST http://localhost:8000/api/ocr/analyze \
  -F "file=@page.png" \
  | jq '.data'
```

### Check What's Happening
```bash
# Backend logs
tail -f logs/backend.log

# Browser console (F12 → Console)
# Check for network requests
```

## Performance Tips

- **Use Maximum Quality** for important documents (uses backend)
- **Use Balanced** for quick previews (fast browser processing)
- **Enable GPU** if available for 10x speed boost
- **Batch Processing** for multiple files

## Architecture

```
PDF Upload
    ↓
Backend Available? → Yes → Use PaddleOCR (95%+ accurate)
    ↓ No             ↓
  Use               Extract Text
Browser OCR      + Languages
    ↓              + Layout
   Text          + Confidence
    ↓
Export to
DOCX/PPTX/XLSX
    ↓
Download
```

## Useful Commands

```bash
# Stop backend
Ctrl+C (in terminal)

# Restart backend
python main.py

# Clear temp files
rm -rf uploads/* outputs/*

# View backend status
curl http://localhost:8000/api/status

# Test PDF upload
curl -X POST http://localhost:8000/api/convert \
  -F "file=@test.pdf" \
  -F "output_format=docx"
```

## Resources

- 📖 [Full Documentation](./BACKEND_INTEGRATION.md)
- 🔧 [Backend Setup](./artifacts/pdf-converter-py/README.md)
- 🐛 [Troubleshooting](./BACKEND_INTEGRATION.md#troubleshooting)
- 📊 [Performance Benchmarks](./IMPLEMENTATION_SUMMARY.md#performance-benchmarks)

---

**Ready to convert PDFs? Start both services and go to http://localhost:23735! 🚀**
