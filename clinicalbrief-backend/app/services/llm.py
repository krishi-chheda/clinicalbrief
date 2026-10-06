"""Local LLM gateway (Ollama). Patient data must never leave this machine.

Enforced here, not by convention:
- the server URL must be a loopback address (localhost / 127.0.0.1 / ::1);
- the model must run locally: Ollama "cloud" models (entries with a remote_host) are refused, because
  prompts to them are sent to ollama.com.
"""
import json
import logging
import urllib.error
import urllib.request
from urllib.parse import urlparse

from app.core.config import settings

logger = logging.getLogger("clinicalbrief.llm")

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


class Reply(str):
    """Model output; `truncated` travels with the text (N-24: the shared singleton must hold no per-call state)."""
    truncated = False


class LLMUnavailable(Exception):
    """The local model can't be used (server down, model missing, or not local)."""


class LocalLLM:
    def __init__(self, base_url: str = None, model: str = None, timeout: float = None):
        self.base_url = (base_url or settings.LLM_BASE_URL).rstrip("/")
        self.model = model or settings.LLM_MODEL
        self.timeout = timeout or settings.LLM_TIMEOUT_SECONDS

    def _request(self, path: str, payload: dict | None = None, timeout: float = 5) -> dict:
        host = urlparse(self.base_url).hostname
        if host not in LOOPBACK_HOSTS:
            raise LLMUnavailable(f"LLM server {host!r} is not local; patient data may only go to a loopback address")
        data = json.dumps(payload).encode() if payload is not None else None
        # "localhost" resolves to ::1 first on Windows; Ollama listens on IPv4 only, so every call waited ~2 s.
        base = self.base_url.replace("://localhost", "://127.0.0.1", 1)
        req = urllib.request.Request(f"{base}{path}", data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise LLMUnavailable(f"Local LLM server unreachable at {self.base_url}: {e}") from e

    def check(self) -> bool:
        """Raises LLMUnavailable unless the configured model is installed and runs locally.
        Returns whether it is a reasoning ("thinking") model."""
        models = self._request("/api/tags").get("models", [])
        entry = next((m for m in models if m.get("name") in (self.model, f"{self.model}:latest")), None)
        if entry is None:
            raise LLMUnavailable(f"Model {self.model!r} is not installed (run: ollama pull {self.model})")
        if entry.get("remote_host") or entry.get("remote_model"):
            raise LLMUnavailable(f"Model {self.model!r} is an Ollama cloud model (runs on {entry.get('remote_host')}); "
                                 "only local models may receive patient data")
        # Reasoning ("thinking") models would spend the output budget on hidden reasoning; answers need none.
        return "thinking" in self._request("/api/show", {"model": self.model}).get("capabilities", [])

    def chat(self, messages: list[dict], max_tokens: int = 800) -> Reply:
        """Deterministic (temperature 0) and always output-capped: uncapped, small models can loop until timeout.
        The reply's `truncated` is True when the cap was hit."""
        thinking = self.check()
        result = self._request("/api/chat", {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "keep_alive": "30m",  # Ollama's default 5 min means a ~45 s cold load for most questions
            "options": {"temperature": 0, "num_ctx": 8192, "num_predict": max_tokens},
            **({"think": False} if thinking else {}),
        }, timeout=self.timeout)
        reply = Reply(result.get("message", {}).get("content", "").strip())
        reply.truncated = result.get("done_reason") == "length"
        return reply


local_llm = LocalLLM()
