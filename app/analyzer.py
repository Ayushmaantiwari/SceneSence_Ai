import base64
import json
import re
from functools import lru_cache
from io import BytesIO
from typing import Any

from PIL import Image

from .config import get_settings

PROMPT = '''Study the image and return one JSON object only, without markdown, using exactly this structure:
{"summary":"A concise 2-4 sentence scene description.","objects":[{"name":"object","attributes":{"color":"visible color","appearance":"visible details"},"location":"left, right, center, foreground, or background"}],"relationships":[{"subject":"object","relation":"relation","object":"object"}],"activities":["visible activity"],"context":"setting and context"}
Describe only visible evidence. Include up to 12 salient objects. Use empty arrays if there are no clear relationships or activities. Do not infer identities, intentions, or facts that cannot be seen.'''


class AnalysisError(RuntimeError):
    pass


def _parse_json(raw: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.I)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        raise AnalysisError("The model returned a plain-text description instead of structured JSON.")
    try:
        parsed = json.loads(cleaned[start:end + 1])
    except json.JSONDecodeError as exc:
        raise AnalysisError("The model returned malformed JSON. Please try again.") from exc
    if not isinstance(parsed, dict):
        raise AnalysisError("The model response was not a JSON object.")
    return parsed


def _normalize(data: dict[str, Any], model: str) -> dict[str, Any]:
    objects = []
    for item in data.get("objects", []) if isinstance(data.get("objects"), list) else []:
        if isinstance(item, str):
            item = {"name": item}
        if isinstance(item, dict) and item.get("name"):
            attrs = item.get("attributes", {})
            objects.append({"name": str(item["name"]), "attributes": attrs if isinstance(attrs, dict) else {}, "location": str(item.get("location", ""))})
    relationships = []
    for rel in data.get("relationships", []) if isinstance(data.get("relationships"), list) else []:
        if isinstance(rel, dict) and rel.get("subject") and rel.get("relation") and rel.get("object"):
            relationships.append({key: str(rel[key]) for key in ("subject", "relation", "object")})
    activities = data.get("activities", [])
    activities = [str(value) for value in activities if isinstance(value, (str, int, float))] if isinstance(activities, list) else []
    result = {
        "summary": str(data.get("summary") or "Scene analysis complete."),
        "objects": objects[:12],
        "relationships": relationships,
        "activities": activities,
        "context": str(data.get("context", "")),
        "model": model,
    }
    if data.get("warning"):
        result["warning"] = str(data["warning"])
    return result


@lru_cache(maxsize=1)
def _load_local_model():
    settings = get_settings()
    try:
        import torch
        from transformers import pipeline

        device = 0 if settings.model_device == "cuda" else (-1 if settings.model_device == "cpu" else (0 if torch.cuda.is_available() else -1))
        return pipeline("image-text-to-text", model=settings.model_id, device=device)
    except Exception as exc:
        raise AnalysisError(f"Could not load local model '{settings.model_id}'. Check the model ID, network access for the initial download, and available memory. Details: {exc}") from exc


def analyze(image: Image.Image) -> dict[str, Any]:
    settings = get_settings()
    model = settings.model_id
    raw = ""
    if settings.model_provider == "openrouter":
        if not settings.openrouter_api_key:
            raise AnalysisError("Set OPENROUTER_API_KEY in your .env file to use OpenRouter.")
        try:
            from openai import OpenAI

            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=88)
            image_data = "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
            response = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=settings.openrouter_api_key, timeout=120).chat.completions.create(
                model=settings.model_id,
                messages=[{"role": "user", "content": [{"type": "image_url", "image_url": {"url": image_data}}, {"type": "text", "text": PROMPT}]}],
                max_tokens=700,
                temperature=0.2,
                response_format={"type": "json_object"},
            )
            model = response.model or model
            raw = response.choices[0].message.content or ""
        except Exception as exc:
            raise AnalysisError(f"OpenRouter inference failed: {exc}") from exc
    elif settings.model_provider == "hf_api":
        if not settings.hf_token:
            raise AnalysisError("Set HF_TOKEN in your .env file to use the Hugging Face provider.")
        try:
            from huggingface_hub import InferenceClient

            buf = BytesIO()
            image.save(buf, format="JPEG", quality=88)
            data_url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
            response = InferenceClient(model=settings.model_id, token=settings.hf_token).chat_completion(
                messages=[{"role": "user", "content": [{"type": "image_url", "image_url": {"url": data_url}}, {"type": "text", "text": PROMPT}]}],
                max_tokens=700, temperature=0.2,
            )
            model = getattr(response, "model", None) or model
            content = response.choices[0].message.content or ""
            raw = "".join(part.get("text", "") for part in content if isinstance(part, dict)) if isinstance(content, list) else str(content)
        except Exception as exc:
            raise AnalysisError(f"Hugging Face inference failed: {exc}") from exc
    elif settings.model_provider == "transformers":
        try:
            conversation = [{"role": "user", "content": [{"type": "image", "image": image}, {"type": "text", "text": PROMPT}]}]
            generated = _load_local_model()(text=conversation, max_new_tokens=800, return_full_text=False)
            raw = generated[0].get("generated_text", "")
            if isinstance(raw, list):
                raw = "".join(part.get("text", "") for part in raw if isinstance(part, dict))
            raw = str(raw)
        except AnalysisError:
            raise
        except Exception as exc:
            raise AnalysisError(f"Local inference failed: {exc}") from exc
    else:
        raise AnalysisError("MODEL_PROVIDER must be openrouter, hf_api, or transformers.")

    try:
        data = _parse_json(raw)
    except AnalysisError:
        if not raw.strip():
            raise AnalysisError("The model returned an empty response. Please try again.")
        data = {"summary": raw.strip(), "objects": [], "relationships": [], "activities": [], "context": "", "warning": "This model returned a text description rather than structured JSON, so structured scene fields are unavailable for this response."}
    return _normalize(data, model)
