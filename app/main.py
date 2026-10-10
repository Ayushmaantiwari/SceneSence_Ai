import logging
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from .analyzer import AnalysisError, analyze
from .config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scenesense")
settings = get_settings()
static_dir = Path(__file__).resolve().parent / "static"
app = FastAPI(title=settings.app_name, version="1.0.0", description="Analyze images into structured scene descriptions.")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/", response_class=HTMLResponse)
async def home():
    return (static_dir / "index.html").read_text(encoding="utf-8")


@app.get("/api/health")
async def health():
    configured = settings.model_provider == "transformers" or (settings.model_provider == "hf_api" and bool(settings.hf_token)) or (settings.model_provider == "openrouter" and bool(settings.openrouter_api_key))
    return {"status": "ok", "provider": settings.model_provider, "model": settings.model_id, "configured": configured}


@app.post("/api/analyze")
async def analyze_image(file: UploadFile = File(...)):
    allowed = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"}
    if file.content_type not in allowed:
        raise HTTPException(415, "Upload a JPEG, PNG, WebP, GIF, or BMP image.")
    content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    await file.close()
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Image exceeds the {settings.max_upload_mb} MB upload limit.")
    try:
        image = ImageOps.exif_transpose(Image.open(BytesIO(content))).convert("RGB")
        image.thumbnail((settings.max_image_side, settings.max_image_side), Image.Resampling.LANCZOS)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(400, "The uploaded file is not a readable image.")
    try:
        result = await run_in_threadpool(analyze, image)
        result["image"] = {"width": image.width, "height": image.height}
        return result
    except AnalysisError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected scene analysis failure")
        raise HTTPException(500, "Analysis failed unexpectedly. Check the server log and try again.") from exc
