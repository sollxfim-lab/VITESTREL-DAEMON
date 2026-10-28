from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import struct
import time
from typing import Any
from urllib.parse import quote, urlencode

from config import SECRET, TOKEN_TTL


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 180_000)
    return f"pbkdf2${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$", 2)
    except ValueError:
        return False
    if scheme != "pbkdf2":
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 180_000)
    return hmac.compare_digest(check.hex(), digest)


def sign_token(payload: dict[str, Any], ttl: int = TOKEN_TTL) -> str:
    body = dict(payload)
    body["iat"] = int(time.time())
    body["exp"] = int(time.time()) + ttl
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    data = _b64encode(json.dumps(body, separators=(",", ":")).encode())
    sig = _b64encode(hmac.new(SECRET.encode(), f"{header}.{data}".encode(), hashlib.sha256).digest())
    return f"{header}.{data}.{sig}"


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        header, data, sig = token.split(".")
    except ValueError:
        return None
    expect = _b64encode(hmac.new(SECRET.encode(), f"{header}.{data}".encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(expect, sig):
        return None
    try:
        payload = json.loads(_b64decode(data).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


# ---------------------------------------------------------------------------
# Time-based one-time passwords (RFC 6238) and recovery codes
# ---------------------------------------------------------------------------

TOTP_STEP = 30
TOTP_DIGITS = 6


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _hotp(secret: str, counter: int) -> str:
    padded = secret + "=" * (-len(secret) % 8)
    key = base64.b32decode(padded)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10**TOTP_DIGITS)).zfill(TOTP_DIGITS)


def totp_code(secret: str, at: float | None = None) -> tuple[str, int]:
    counter = int((at if at is not None else time.time()) // TOTP_STEP)
    return _hotp(secret, counter), counter


def verify_totp(
    secret: str, code: str, window: int = 1, last_step: int = 0
) -> tuple[bool, int]:
    """Verify a six-digit code and reject replayed steps.

    ``last_step`` is the counter stored after the previous successful login.
    Codes belonging to that step or an earlier step are never accepted again.
    """

    cleaned = re.sub(r"\s+", "", code or "")
    if not cleaned.isdigit() or len(cleaned) != TOTP_DIGITS:
        return False, 0
    counter = int(time.time() // TOTP_STEP)
    for delta in range(-window, window + 1):
        candidate = counter + delta
        if candidate <= last_step:
            continue
        if hmac.compare_digest(_hotp(secret, candidate), cleaned):
            return True, candidate
    return False, 0


def otpauth_uri(secret: str, account: str, issuer: str) -> str:
    label = quote(f"{issuer}:{account}", safe="")
    query = urlencode(
        {
            "secret": secret,
            "issuer": issuer,
            "algorithm": "SHA1",
            "digits": TOTP_DIGITS,
            "period": TOTP_STEP,
        }
    )
    return f"otpauth://totp/{label}?{query}"


def generate_recovery_code() -> str:
    raw = secrets.token_hex(4).upper()
    return f"{raw[:4]}-{raw[4:]}"


def hash_recovery_code(code: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]", "", code or "").upper()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
