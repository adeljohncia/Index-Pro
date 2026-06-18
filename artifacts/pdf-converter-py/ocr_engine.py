"""
========================================================
ADVANCED AI OCR + PDF CONVERSION ENHANCEMENT MODULE
========================================================
GPU-accelerated OCR with multilingual support,
image preprocessing, and intelligent text extraction
"""

import os
import cv2
import uuid
import shutil
import numpy as np
import torch
import pytesseract
import easyocr
import logging

from typing import List, Dict, Any, Tuple
from PIL import Image
from pdf2image import convert_from_path
from paddleocr import PaddleOCR
from langdetect import detect, DetectorFactory
from textblob import TextBlob

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Set seed for consistency
DetectorFactory.seed = 0

# ========================================================
# GPU DETECTION
# ========================================================

USE_GPU = torch.cuda.is_available()
logger.info(f"GPU Available: {USE_GPU}")

if USE_GPU:
    logger.info(f"CUDA Device: {torch.cuda.get_device_name(0)}")


# ========================================================
# OCR ENGINES INITIALIZATION
# ========================================================

class OCREngines:
    """Lazy initialization of OCR engines to save memory"""
    
    _paddle = None
    _easy_reader = None
    
    @staticmethod
    def get_paddle():
        if OCREngines._paddle is None:
            logger.info("Initializing PaddleOCR...")
            OCREngines._paddle = PaddleOCR(
                use_angle_cls=True,
                lang='en',
                use_gpu=USE_GPU,
                show_log=False,
                cls_model_dir=None,
                rec_model_dir=None
            )
        return OCREngines._paddle
    
    @staticmethod
    def get_easy_reader():
        if OCREngines._easy_reader is None:
            logger.info("Initializing EasyOCR...")
            OCREngines._easy_reader = easyocr.Reader(
                ['en', 'ms', 'ch_sim', 'ar', 'ja'],
                gpu=USE_GPU
            )
        return OCREngines._easy_reader


# ========================================================
# IMAGE PREPROCESSING
# ========================================================

def preprocess_image(image_path: str, upscale_factor: float = 2.0) -> np.ndarray:
    """
    Advanced image preprocessing for OCR
    
    Args:
        image_path: Path to image file
        upscale_factor: Scaling factor for upsampling (default 2.0)
    
    Returns:
        Processed image array ready for OCR
    """
    try:
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not read image: {image_path}")
        
        # Upscale blurry scans for better OCR
        height, width = image.shape[:2]
        new_width = int(width * upscale_factor)
        new_height = int(height * upscale_factor)
        
        logger.info(f"Upscaling image from {width}x{height} to {new_width}x{new_height}")
        image = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_CUBIC)
        
        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Denoise
        logger.info("Denoising image...")
        denoise = cv2.fastNlMeansDenoising(gray, h=10, templateWindowSize=7, searchWindowSize=21)
        
        # Sharpen
        logger.info("Sharpening image...")
        kernel = np.array([
            [-1, -1, -1],
            [-1, 9, -1],
            [-1, -1, -1]
        ], dtype=np.float32) / 1.0
        
        sharpen = cv2.filter2D(denoise, -1, kernel)
        
        # Adaptive threshold for better text clarity
        logger.info("Applying adaptive threshold...")
        processed = cv2.adaptiveThreshold(
            sharpen,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            2
        )
        
        return processed
    
    except Exception as e:
        logger.error(f"Error preprocessing image: {e}")
        raise


# ========================================================
# LANGUAGE DETECTION
# ========================================================

def detect_language(text: str) -> str:
    """
    Detect language of text
    
    Args:
        text: Text to analyze
    
    Returns:
        Language code (e.g., 'en', 'es', 'zh-cn')
    """
    try:
        if not text or len(text.strip()) < 2:
            return "unknown"
        return detect(text)
    except Exception as e:
        logger.warning(f"Language detection failed: {e}")
        return "unknown"


def detect_languages_in_text(text: str) -> List[str]:
    """
    Detect multiple languages in text
    
    Args:
        text: Text to analyze
    
    Returns:
        List of detected language codes
    """
    try:
        sentences = text.split('.')
        detected_langs = set()
        
        for sentence in sentences[:10]:  # Check first 10 sentences
            if len(sentence.strip()) > 5:
                lang = detect_language(sentence.strip())
                if lang != "unknown":
                    detected_langs.add(lang)
        
        return list(detected_langs) if detected_langs else ["unknown"]
    except Exception as e:
        logger.warning(f"Multi-language detection failed: {e}")
        return ["unknown"]


# ========================================================
# AI TEXT CORRECTION
# ========================================================

def correct_text(text: str, confidence: float) -> str:
    """
    Apply AI-based spell and grammar correction
    
    Args:
        text: Text to correct
        confidence: OCR confidence score (0-1)
    
    Returns:
        Corrected text
    """
    try:
        # Only correct if confidence is below threshold
        if confidence < 0.75 and len(text.split()) <= 20:
            corrected = str(TextBlob(text).correct())
            logger.info(f"Corrected low-confidence text: '{text}' -> '{corrected}'")
            return corrected
        return text
    except Exception as e:
        logger.warning(f"Text correction failed: {e}")
        return text


# ========================================================
# OCR PROCESSING
# ========================================================

def run_advanced_ocr(image_path: str, fallback_threshold: float = 0.80) -> List[Dict[str, Any]]:
    """
    Run advanced OCR with multiple engines and fallback strategies
    
    Args:
        image_path: Path to image file
        fallback_threshold: Confidence threshold for fallback OCR
    
    Returns:
        List of extracted text data with coordinates and metadata
    """
    try:
        logger.info(f"Starting advanced OCR on: {image_path}")
        
        # Preprocess image
        processed = preprocess_image(image_path)
        
        # Save enhanced version
        enhanced_path = image_path.replace(".png", "_enhanced.png")
        cv2.imwrite(enhanced_path, processed)
        logger.info(f"Saved enhanced image to: {enhanced_path}")
        
        # Run PaddleOCR (primary engine)
        logger.info("Running PaddleOCR...")
        paddle = OCREngines.get_paddle()
        results = paddle.ocr(enhanced_path, cls=True)
        
        extracted_data = []
        
        if results and results[0]:
            for line in results[0]:
                box = line[0]
                text = line[1][0]
                confidence = line[1][1]
                
                logger.info(f"PaddleOCR result: '{text}' (confidence: {confidence:.2%})")
                
                # Fallback OCR for low confidence
                if confidence < fallback_threshold:
                    logger.info(f"Low confidence ({confidence:.2%}), trying EasyOCR fallback...")
                    try:
                        easy_reader = OCREngines.get_easy_reader()
                        fallback_results = easy_reader.readtext(enhanced_path)
                        
                        if fallback_results and len(fallback_results) > 0:
                            fallback_text = fallback_results[0][1]
                            fallback_conf = fallback_results[0][2]
                            
                            if fallback_conf > confidence:
                                logger.info(f"Using EasyOCR result: '{fallback_text}' ({fallback_conf:.2%})")
                                text = fallback_text
                                confidence = fallback_conf
                    except Exception as e:
                        logger.warning(f"EasyOCR fallback failed: {e}")
                
                # AI spell correction for very low confidence
                if confidence < 0.70:
                    text = correct_text(text, confidence)
                
                # Language detection
                language = detect_language(text)
                
                # Extract coordinates
                x = float(box[0][0])
                y = float(box[0][1])
                
                extracted_data.append({
                    "text": text.strip(),
                    "confidence": float(confidence),
                    "language": language,
                    "x": x,
                    "y": y,
                    "coordinates": [[float(p[0]), float(p[1])] for p in box]
                })
        
        logger.info(f"Extracted {len(extracted_data)} text elements")
        
        # Preserve reading order (top-to-bottom, left-to-right)
        extracted_data.sort(key=lambda k: (k['y'], k['x']))
        
        # Filter low-confidence garbage
        filtered = [x for x in extracted_data if x["confidence"] > 0.50]
        
        logger.info(f"Filtered to {len(filtered)} high-confidence elements")
        
        # Cleanup
        if os.path.exists(enhanced_path):
            os.remove(enhanced_path)
        
        return filtered
    
    except Exception as e:
        logger.error(f"Advanced OCR failed: {e}")
        raise


# ========================================================
# TABLE DETECTION
# ========================================================

def detect_tables(image_path: str) -> np.ndarray:
    """
    Detect table structures in image
    
    Args:
        image_path: Path to image file
    
    Returns:
        Binary image with detected table lines
    """
    try:
        logger.info("Detecting table structures...")
        
        image = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise ValueError(f"Could not read image: {image_path}")
        
        # Binary threshold
        _, thresh = cv2.threshold(image, 150, 255, cv2.THRESH_BINARY_INV)
        
        # Detect horizontal lines
        horizontal_kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT,
            (40, 1)
        )
        detect_horizontal = cv2.morphologyEx(
            thresh,
            cv2.MORPH_OPEN,
            horizontal_kernel,
            iterations=2
        )
        
        # Detect vertical lines
        vertical_kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT,
            (1, 40)
        )
        detect_vertical = cv2.morphologyEx(
            thresh,
            cv2.MORPH_OPEN,
            vertical_kernel,
            iterations=2
        )
        
        # Combine
        result = cv2.add(detect_horizontal, detect_vertical)
        
        logger.info("Table detection complete")
        return result
    
    except Exception as e:
        logger.error(f"Table detection failed: {e}")
        return np.zeros_like(cv2.imread(image_path, cv2.IMREAD_GRAYSCALE))


# ========================================================
# LAYOUT ANALYSIS
# ========================================================

def analyze_layout(extracted_data: List[Dict[str, Any]], page_width: int, page_height: int) -> Dict[str, Any]:
    """
    Analyze page layout to detect columns and structure
    
    Args:
        extracted_data: OCR results
        page_width: Page width in pixels
        page_height: Page height in pixels
    
    Returns:
        Layout analysis including column detection
    """
    try:
        logger.info("Analyzing page layout...")
        
        if not extracted_data:
            return {"columns": 1, "column_boundaries": [0, page_width]}
        
        # Extract X coordinates
        x_coords = sorted(set([d['x'] for d in extracted_data]))
        
        # Detect column breaks (gaps > 100 pixels)
        column_breaks = [0]
        for i in range(len(x_coords) - 1):
            gap = x_coords[i + 1] - x_coords[i]
            if gap > 100:
                column_breaks.append(x_coords[i])
        column_breaks.append(page_width)
        
        # Remove duplicates and sort
        column_breaks = sorted(set(column_breaks))
        
        num_columns = len(column_breaks) - 1
        
        logger.info(f"Detected {num_columns} columns at boundaries: {column_breaks}")
        
        return {
            "columns": num_columns,
            "column_boundaries": column_breaks,
            "avg_confidence": np.mean([d['confidence'] for d in extracted_data])
        }
    
    except Exception as e:
        logger.error(f"Layout analysis failed: {e}")
        return {"columns": 1, "column_boundaries": [0, page_width]}


def group_text_by_lines(extracted_data: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """
    Group text elements into lines
    
    Args:
        extracted_data: OCR results
    
    Returns:
        Grouped text by reading lines
    """
    if not extracted_data:
        return []
    
    lines = []
    current_line = []
    current_y = extracted_data[0]['y']
    
    for item in extracted_data:
        if abs(item['y'] - current_y) < 20:  # Same line threshold
            current_line.append(item)
        else:
            if current_line:
                lines.append(sorted(current_line, key=lambda x: x['x']))
            current_line = [item]
            current_y = item['y']
    
    if current_line:
        lines.append(sorted(current_line, key=lambda x: x['x']))
    
    return lines
