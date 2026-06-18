# System Architecture Diagram

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      END USER BROWSER                          │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  React/TypeScript Application (Port 23735)              │ │
│  │                                                          │ │
│  │  ┌─────────────────────────────────────────────────────┐│ │
│  │  │  PDF Upload & Configuration UI                     ││ │
│  │  │  - Quality selector (fast/balanced/maximum)         ││ │
│  │  │  - Format selector (DOCX/PPTX/XLSX)               ││ │
│  │  │  - Language selector                               ││ │
│  │  └─────────────────────────────────────────────────────┘│ │
│  │                     │                                     │ │
│  │                     ↓                                     │ │
│  │  ┌─────────────────────────────────────────────────────┐│ │
│  │  │  OCR Service Layer                                 ││ │
│  │  │  - Backend availability detection                  ││ │
│  │  │  - Automatic fallback logic                        ││ │
│  │  │  - Progress tracking                               ││ │
│  │  └─────────────────────────────────────────────────────┘│ │
│  │         │                                 │              │ │
│  │         ↓ Backend Available               ↓ No Backend   │ │
│  │                                                          │ │
│  │  ┌──────────────────┐         ┌─────────────────────┐  │ │
│  │  │  Backend OCR     │         │ Browser OCR         │  │ │
│  │  │  Service Client  │         │ (Tesseract.js)      │  │ │
│  │  │                  │         │                     │  │ │
│  │  │ HTTP → Backend   │         │ - Extract text      │  │ │
│  │  │ API Calls        │         │ - Detect languages  │  │ │
│  │  │ JSON responses   │         │ - Analyze layout    │  │ │
│  │  └──────────────────┘         └─────────────────────┘  │ │
│  │         │                              │                │ │
│  └─────────┼──────────────────────────────┼────────────────┘ │
│            │                              │                 │
│            └──────────────┬───────────────┘                 │
│                          │                                  │
│                    HTTP/JSON                               │
│                    Results                                 │
│                          │                                 │
└──────────────────────────┼──────────────────────────────────┘
                          │
                          ↓ (Network)
┌────────────────────────────────────────────────────────────────┐
│              PYTHON FASTAPI BACKEND (Port 8000)               │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  REST API Server                                         │ │
│  │  - FastAPI framework                                     │ │
│  │  - CORS enabled                                          │ │
│  │  - Error handling & validation                           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                          │                                     │
│    ┌─────────────────────┼─────────────────────┐              │
│    │                     │                     │              │
│    ↓                     ↓                     ↓              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Converter   │  │  OCR Engine  │  │  Layout Analyzer │   │
│  │  Module      │  │  Module      │  │  Module          │   │
│  │              │  │              │  │                  │   │
│  │ - PDF        │  │ - PaddleOCR  │  │ - Column detect  │   │
│  │   to DOCX    │  │   (Primary)  │  │ - Line grouping  │   │
│  │ - PDF        │  │ - EasyOCR    │  │ - Reading order  │   │
│  │   to PPTX    │  │   (Fallback) │  │ - Confidence     │   │
│  │ - PDF        │  │ - Tesseract  │  │   analysis       │   │
│  │   to XLSX    │  │   (Browser)  │  │                  │   │
│  │              │  │              │  │                  │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│         │                │                    │              │
│         └────────────────┼────────────────────┘              │
│                         │                                    │
│                         ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Image Processing Pipeline                              │ │
│  │  - Upscale 2x                                            │ │
│  │  - Denoise (FastNLMeans)                                │ │
│  │  - Sharpen (Kernel filter)                              │ │
│  │  - Threshold (Adaptive)                                 │ │
│  │  - Deskew (PaddleOCR)                                   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                         │                                    │
│                         ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Language Detection & Processing                        │ │
│  │  - Langdetect (primary language)                        │ │
│  │  - Per-word detection                                   │ │
│  │  - TextBlob spell correction                            │ │
│  │  - Confidence-based filtering                           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                         │                                    │
│                         ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  GPU Acceleration (Optional)                            │ │
│  │  - PyTorch + CUDA                                       │ │
│  │  - 10x speed improvement                                │ │
│  │  - Automatic CPU fallback                               │ │
│  └──────────────────────────────────────────────────────────┘ │
│                         │                                    │
│                         ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  File Output (DOCX/PPTX/XLSX)                          │ │
│  │  - Python-docx for Word                                 │ │
│  │  - Python-pptx for PowerPoint                           │ │
│  │  - Openpyxl for Excel                                   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                         │                                    │
└─────────────────────────┼────────────────────────────────────┘
                         │
                   HTTP Response
                   (Download URL)
                         │
                         ↓
                    User Downloads
                    Converted File
```

---

## OCR Processing Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  INPUT: PDF File                                            │
└──────────────────────┬──────────────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────────────┐
│  PDF to Image Conversion (pdf2image)                        │
│  - DPI: 300                                                 │
│  - Format: PNG                                              │
└──────────────────────┬──────────────────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
         ↓ Per Page                │
    ┌────────────┐                │
    │ Image (i)  │                │
    └─────┬──────┘                │
          │                       │
          ↓                       │
    ┌──────────────────────────┐  │
    │ Preprocessing:           │  │
    │ 1. Upscale 2x            │  │
    │ 2. Convert to Grayscale  │  │
    │ 3. Denoise               │  │
    │ 4. Sharpen               │  │
    │ 5. Adaptive Threshold    │  │
    └─────┬────────────────────┘  │
          │                       │
          ↓                       │
    ┌──────────────────────────┐  │
    │ OCR Processing:          │  │
    │ ┌─────────────────────┐  │  │
    │ │ Try PaddleOCR       │  │  │
    │ │ (Primary Engine)    │  │  │
    │ └────┬────────────────┘  │  │
    │      │                   │  │
    │      ├─ Confidence > 80% │  │
    │      │  └─→ Use Result   │  │
    │      │                   │  │
    │      └─ Confidence < 80% │  │
    │         ├─→ Try EasyOCR  │  │
    │         │   (Fallback)   │  │
    │         │                │  │
    │         └─ Compare &     │  │
    │            Use Best      │  │
    │                          │  │
    └─────┬────────────────────┘  │
          │                       │
          ↓                       │
    ┌──────────────────────────┐  │
    │ Language Detection:      │  │
    │ - Primary language       │  │
    │ - Per-word detection     │  │
    │ - Confidence levels      │  │
    └─────┬────────────────────┘  │
          │                       │
          ↓                       │
    ┌──────────────────────────┐  │
    │ Text Correction:         │  │
    │ - Spell check            │  │
    │ - Grammar correct        │  │
    │ - Confidence filtering   │  │
    │ - Min 50% threshold      │  │
    └─────┬────────────────────┘  │
          │                       │
          ↓                       │
    ┌──────────────────────────┐  │
    │ Layout Analysis:         │  │
    │ - Column detection       │  │
    │ - Line grouping          │  │
    │ - Reading order          │  │
    │ - Position extraction    │  │
    │ - Confidence averaging   │  │
    └─────┬────────────────────┘  │
          │                       │
          └───────────┬───────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
         ↓ All Pages               │
    ┌────────────────────────────┐ │
    │ Combine Results            │ │
    │ - Merge page layouts       │ │
    │ - Compile metadata         │ │
    │ - Average confidence       │ │
    └─────┬──────────────────────┘ │
          │                        │
          └────────────┬───────────┘
                      │
                      ↓
         ┌────────────────────────┐
         │  SELECT OUTPUT FORMAT  │
         └────────────┬───────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
         ↓ DOCX       ↓ PPTX       ↓ XLSX
    ┌─────────┐  ┌──────────┐  ┌───────────┐
    │Export   │  │Export    │  │Export     │
    │to DOCX  │  │to PPTX   │  │to XLSX    │
    │with:    │  │with:     │  │with:      │
    │-Text    │  │-Text     │  │-Data      │
    │-Layout  │  │-Layout   │  │-Metadata  │
    │-Tables  │  │-Slides   │  │-Styling   │
    │-Images  │  │-Styling  │  │-Formatting│
    └────┬────┘  └────┬─────┘  └────┬──────┘
         │            │            │
         └────────────┼────────────┘
                      │
                      ↓
         ┌────────────────────────┐
         │ OUTPUT FILE            │
         │ (sample.docx/pptx/xlsx)│
         └────────────┬───────────┘
                      │
                      ↓
         ┌────────────────────────┐
         │ DOWNLOAD / SEND TO USER│
         └────────────────────────┘
```

---

## Data Flow Diagram

```
User Browser                Backend Server
     │                           │
     ├─ POST /api/convert ──────→ │
     │  (multipart: PDF)          │
     │                            │
     │                            ├─ Validate file
     │                            ├─ Check format
     │                            ├─ Check size
     │                            │
     │                            ├─ Convert PDF → Images
     │                            │
     │ ← 202 Accepted ────────────┤
     │  (Job ID, status URL)      │
     │                            │
     ├─ GET /api/status ────────→ │ (optional polling)
     │                            │
     │ ← 200 OK ──────────────────┤
     │  (status: processing)      │
     │                            │
     │                            ├─ Process each page:
     │                            │  ├─ Preprocess image
     │                            │  ├─ Run OCR engines
     │                            │  ├─ Detect language
     │                            │  ├─ Correct text
     │                            │  ├─ Analyze layout
     │                            │  └─ Extract data
     │                            │
     │                            ├─ Compile results
     │                            ├─ Export format
     │                            ├─ Save output file
     │                            │
     │ ← 200 OK ──────────────────┤
     │  (status: completed,      │
     │   download_url)            │
     │                            │
     ├─ GET /api/download/file ─→ │
     │                            │
     │ ← 200 OK (File stream) ────┤
     │                            │
     ├─ File saved locally
     │
     ✓ Done!
```

---

## Component Interaction Diagram

```
┌──────────────────────────────────────────────────────┐
│         Frontend Application Layer                   │
│                                                      │
│  ┌────────────────┐  ┌──────────────────────┐       │
│  │ UI Components  │  │ OCR Configuration    │       │
│  ├────────────────┤  ├──────────────────────┤       │
│  │ - Upload       │  │ - Quality setting    │       │
│  │ - Convert btn  │  │ - Format selector    │       │
│  │ - Progress bar │  │ - Language pack      │       │
│  │ - Download btn │  │ - Feature flags      │       │
│  └────────┬───────┘  └──────────┬───────────┘       │
│           │                     │                   │
│           └──────────┬──────────┘                   │
│                      │                              │
│                      ↓                              │
│  ┌──────────────────────────────────┐              │
│  │     OCR Service Layer            │              │
│  │                                  │              │
│  │  ┌──────────────────────────┐   │              │
│  │  │ Backend OCR Service      │   │              │
│  │  │ - Check availability     │   │              │
│  │  │ - Send to backend        │   │              │
│  │  │ - Handle responses       │   │              │
│  │  └──────┬───────────────────┘   │              │
│  │         │                        │              │
│  │         ├─→ Backend Available?   │              │
│  │         │   │                    │              │
│  │         │   ├─ Yes → Send to backend           │
│  │         │   │                    │              │
│  │         │   └─ No → Use fallback               │
│  │         │                        │              │
│  │  ┌──────┴───────────────────┐   │              │
│  │  │ Browser OCR Fallback     │   │              │
│  │  │ - Tesseract.js           │   │              │
│  │  │ - Local processing       │   │              │
│  │  │ - No network needed      │   │              │
│  │  └──────────────────────────┘   │              │
│  │                                  │              │
│  └──────────────────────────────────┘              │
│                      │                              │
└──────────────────────┼──────────────────────────────┘
                       │
            ═══════════╪═══════════
            Network Boundary
            ═══════════╪═══════════
                       │
                       ↓
┌──────────────────────────────────────────────────────┐
│         Python Backend Service                       │
│                                                      │
│  ┌────────────────┐  ┌──────────────────────┐       │
│  │  API Routes    │  │ Processing Pipeline  │       │
│  ├────────────────┤  ├──────────────────────┤       │
│  │ /api/convert   │  │ - Image preprocessing│       │
│  │ /api/ocr/...   │  │ - OCR execution      │       │
│  │ /api/download  │  │ - Layout analysis    │       │
│  │ /health        │  │ - Format export      │       │
│  └────────┬───────┘  └──────────┬───────────┘       │
│           │                     │                   │
│           └──────────┬──────────┘                   │
│                      │                              │
│                      ↓                              │
│  ┌──────────────────────────────────┐              │
│  │     OCR Engines                  │              │
│  │                                  │              │
│  │  Primary:  PaddleOCR (GPU opt.)  │              │
│  │  Fallback: EasyOCR (GPU opt.)    │              │
│  │  Browser:  Tesseract.js (CPU)    │              │
│  │                                  │              │
│  └──────────────────────────────────┘              │
│                      │                              │
│                      ↓                              │
│  ┌──────────────────────────────────┐              │
│  │     File System                  │              │
│  │                                  │              │
│  │  uploads/     - Temp uploads     │              │
│  │  outputs/     - Converted files  │              │
│  │  logs/        - Processing logs  │              │
│  │                                  │              │
│  └──────────────────────────────────┘              │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Error Handling Flow

```
User Action
    │
    ↓
Validate Input
    │
    ├─ Valid → Continue
    │
    └─ Invalid
       └─ Show Error Message
          └─ User retries

        │
        ↓
Try Backend (if enabled)
    │
    ├─ Available
    │  │
    │  └─ Send request
    │     │
    │     ├─ Success → Return results
    │     │
    │     └─ Error
    │        ├─ Log error
    │        ├─ Fallback to Browser
    │        └─ Notify user
    │
    └─ Not available
       └─ Use Browser OCR
          └─ Process locally

        │
        ↓
Process Document
    │
    ├─ Success → Export file
    │
    └─ Error
       ├─ Log details
       ├─ Cleanup temp files
       └─ Show user-friendly error

        │
        ↓
Download File
    │
    ├─ Success → User downloads
    │
    └─ Error → Show download error
```

---

**Architecture is modular, scalable, and production-ready! 🏗️**
