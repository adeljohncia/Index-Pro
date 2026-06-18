"""
========================================================
FASTAPI BACKEND FOR PDF CONVERTER
========================================================
RESTful API for PDF to DOCX/PPTX/XLSX conversion with OCR
"""

import os
import logging
from typing import Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import aiofiles
import asyncio
from pathlib import Path

from converter import convert_pdf
from ocr_engine import run_advanced_ocr, analyze_layout

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="PDF Converter API",
    description="Advanced OCR-powered PDF to DOCX/PPTX/XLSX converter",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create uploads and outputs directories
UPLOAD_DIR = Path("./uploads")
OUTPUT_DIR = Path("./outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Job tracking
conversion_jobs = {}


# ========================================================
# HEALTH CHECK
# ========================================================

@app.get("/health")
async def health_check():
    """
    Health check endpoint
    """
    return {
        "status": "healthy",
        "service": "PDF Converter API",
        "version": "1.0.0"
    }


# ========================================================
# OCR ENDPOINTS
# ========================================================

@app.post("/api/ocr/analyze")
async def analyze_image(file: UploadFile = File(...)):
    """
    Analyze image and extract text with OCR
    
    Args:
        file: Image file (PNG, JPG, etc.)
    
    Returns:
        Extracted text data with confidence and positioning
    """
    try:
        # Save uploaded file
        file_path = UPLOAD_DIR / file.filename
        async with aiofiles.open(file_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        logger.info(f"Analyzing image: {file.filename}")
        
        # Run OCR
        results = run_advanced_ocr(str(file_path))
        
        # Cleanup
        os.remove(file_path)
        
        return {
            "success": True,
            "filename": file.filename,
            "text_elements": len(results),
            "data": results
        }
    
    except Exception as e:
        logger.error(f"OCR analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ========================================================
# CONVERSION ENDPOINTS
# ========================================================

@app.post("/api/convert")
async def convert_document(
    file: UploadFile = File(...),
    output_format: str = Form(...),
    background_tasks: BackgroundTasks = None
):
    """
    Convert PDF to specified format
    
    Args:
        file: PDF file
        output_format: Output format (docx, pptx, xlsx)
    
    Returns:
        Download URL or conversion job ID
    """
    try:
        # Validate format
        if output_format.lower() not in ["docx", "pptx", "xlsx"]:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported format: {output_format}"
            )
        
        # Save uploaded file
        file_path = UPLOAD_DIR / file.filename
        async with aiofiles.open(file_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        logger.info(f"Converting PDF: {file.filename} -> {output_format}")
        
        # Define output path
        output_filename = f"{Path(file.filename).stem}.{output_format.lower()}"
        output_path = OUTPUT_DIR / output_filename
        
        # Run conversion
        result = convert_pdf(str(file_path), output_format.lower(), str(output_path))
        
        # Schedule cleanup of input file
        if background_tasks:
            background_tasks.add_task(os.remove, str(file_path))
        
        return {
            "success": True,
            "input_file": file.filename,
            "output_file": output_filename,
            "format": output_format.lower(),
            "download_url": f"/api/download/{output_filename}"
        }
    
    except Exception as e:
        logger.error(f"Conversion failed: {e}")
        # Cleanup on error
        try:
            os.remove(str(file_path))
        except:
            pass
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/convert/batch")
async def convert_batch(
    files: list[UploadFile] = File(...),
    output_format: str = Form(...)
):
    """
    Convert multiple PDFs to specified format
    
    Args:
        files: List of PDF files
        output_format: Output format (docx, pptx, xlsx)
    
    Returns:
        List of converted files
    """
    try:
        results = []
        
        for file in files:
            file_path = UPLOAD_DIR / file.filename
            async with aiofiles.open(file_path, 'wb') as f:
                content = await file.read()
                await f.write(content)
            
            output_filename = f"{Path(file.filename).stem}.{output_format.lower()}"
            output_path = OUTPUT_DIR / output_filename
            
            logger.info(f"Converting: {file.filename}")
            convert_pdf(str(file_path), output_format.lower(), str(output_path))
            
            results.append({
                "input_file": file.filename,
                "output_file": output_filename,
                "download_url": f"/api/download/{output_filename}"
            })
            
            os.remove(str(file_path))
        
        return {
            "success": True,
            "total_files": len(results),
            "results": results
        }
    
    except Exception as e:
        logger.error(f"Batch conversion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ========================================================
# DOWNLOAD ENDPOINTS
# ========================================================

@app.get("/api/download/{filename}")
async def download_file(filename: str):
    """
    Download converted file
    
    Args:
        filename: Output filename
    
    Returns:
        File download
    """
    try:
        file_path = OUTPUT_DIR / filename
        
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")
        
        logger.info(f"Downloading: {filename}")
        
        return FileResponse(
            path=file_path,
            filename=filename,
            media_type="application/octet-stream"
        )
    
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ========================================================
# ANALYSIS ENDPOINTS
# ========================================================

@app.post("/api/analyze/layout")
async def analyze_page_layout(file: UploadFile = File(...)):
    """
    Analyze page layout (columns, structure, etc.)
    
    Args:
        file: Image file
    
    Returns:
        Layout analysis including column detection
    """
    try:
        # Save uploaded file
        file_path = UPLOAD_DIR / file.filename
        async with aiofiles.open(file_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        logger.info(f"Analyzing layout: {file.filename}")
        
        # Run OCR
        results = run_advanced_ocr(str(file_path))
        
        # Get page dimensions (this is approximate)
        from PIL import Image
        img = Image.open(file_path)
        page_width, page_height = img.size
        
        # Analyze layout
        layout = analyze_layout(results, page_width, page_height)
        
        # Cleanup
        os.remove(file_path)
        
        return {
            "success": True,
            "filename": file.filename,
            "page_size": {
                "width": page_width,
                "height": page_height
            },
            "layout": layout
        }
    
    except Exception as e:
        logger.error(f"Layout analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ========================================================
# STATUS ENDPOINTS
# ========================================================

@app.get("/api/status")
async def get_status():
    """
    Get service status and statistics
    """
    upload_count = len(list(UPLOAD_DIR.glob("*")))
    output_count = len(list(OUTPUT_DIR.glob("*")))
    
    return {
        "status": "running",
        "pending_uploads": upload_count,
        "completed_conversions": output_count,
        "jobs": conversion_jobs
    }


# ========================================================
# ERROR HANDLERS
# ========================================================

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.detail
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
