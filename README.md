# SceneSense AI

SceneSense AI analyzes an image and turns it into a natural-language scene summary plus structured objects, attributes, spatial relationships, activities, and context. The responsive Ayushmaan’s Visual Studio frontend supports image upload, drag and drop, sample images, dark and light themes, and structured JSON export.

## Requirements

- Python 3.10 or newer
- An OpenRouter API key (or credentials and a compatible image model from another supported provider)
- Internet access for hosted inference and the sample thumbnails

## Run locally on Windows

Open PowerShell in this project directory:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env` and add your OpenRouter key to `OPENROUTER_API_KEY`. The default uses `openrouter/free`, which may select different models depending on current provider availability and limits. A free model route can be rate limited or temporarily unavailable.

Start the web app:

```powershell
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000>.

## Providers

### OpenRouter (default)

```env
MODEL_PROVIDER=openrouter
MODEL_ID=openrouter/free
OPENROUTER_API_KEY=your_key_here
```

Use an image-capable model available to your OpenRouter account. The free router is convenient but model availability, speed, and structured output support vary.

### Hugging Face Inference Providers

```env
MODEL_PROVIDER=hf_api
MODEL_ID=Qwen/Qwen2.5-VL-3B-Instruct
HF_TOKEN=your_token_here
```

This requires a Hugging Face token and access to a provider serving the selected image model. Hosted inference may require credits or have provider-specific rate limits.

### Local Transformers

```env
MODEL_PROVIDER=transformers
MODEL_ID=HuggingFaceTB/SmolVLM-500M-Instruct
MODEL_DEVICE=auto
```

Install optional dependencies with `pip install -r requirements-local.txt`. The first run downloads the model. CPU inference can be slow; GPU memory requirements depend on the model. Keep `MODEL_DEVICE=auto` to use CUDA when available and CPU otherwise.

## API

- `GET /api/health` reports the selected provider, model, and whether credentials are configured.
- `POST /api/analyze` accepts an image as multipart form data under the field name `file` and returns a JSON scene description.

Images are validated, EXIF orientation is applied, and large images are resized before inference. The app does not persist uploaded image files. Hosted providers receive the image for analysis.

## Security

- Keep credentials in `.env`; never commit that file.
- `.gitignore` excludes `.env` and the local virtual environment.
- If a token was ever committed or shared, revoke it at its provider and create a replacement.
