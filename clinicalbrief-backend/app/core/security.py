import logging
from functools import lru_cache
from typing import Optional
import jwt

from app.core.config import settings

logger = logging.getLogger("clinicalbrief.security")

ASYMMETRIC_ALGS = ["ES256", "RS256"]
# Tolerated clock difference between this server and Supabase Auth. Without it, a server clock even one
# second behind rejects every freshly issued token as "not yet valid" (iat in the future).
CLOCK_SKEW_SECONDS = 30


@lru_cache(maxsize=1)
def _jwks_client() -> Optional[jwt.PyJWKClient]:
    if not settings.SUPABASE_URL:
        return None
    # PyJWKClient caches keys and refetches on unknown `kid`, so key rotation is handled.
    return jwt.PyJWKClient(f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json", cache_keys=True)


def decode_supabase_token(token: str) -> Optional[dict]:
    """Verifies a Supabase access token (signature, expiry, audience). Returns claims or None."""
    try:
        alg = jwt.get_unverified_header(token).get("alg")
        if alg == "HS256":
            if not settings.JWT_SECRET:
                logger.warning("HS256 token received but JWT_SECRET is not configured.")
                return None
            key = settings.JWT_SECRET
            algorithms = ["HS256"]
        elif alg in ASYMMETRIC_ALGS:
            client = _jwks_client()
            if client is None:
                logger.warning("Asymmetric token received but SUPABASE_URL is not configured.")
                return None
            key = client.get_signing_key_from_jwt(token).key
            algorithms = ASYMMETRIC_ALGS
        else:
            return None
        return jwt.decode(
            token, key, algorithms=algorithms, audience=settings.JWT_AUDIENCE,
            options={"require": ["exp", "sub"]}, leeway=CLOCK_SKEW_SECONDS,
        )
    except jwt.PyJWTError as e:
        # Log the reason (expired, bad audience, bad signature) but never the token itself.
        logger.info(f"Rejected access token: {type(e).__name__}")
        return None
