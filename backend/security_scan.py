"""Heuristic detection for dangerous server activity.

The panel is an operator tool, not a sandbox. This scanner is deliberately
conservative: it looks for known attack tooling, packet-flood constructs,
destructive host commands, and a small number of high-confidence code shapes.
Every match is blocked before execution; critical matches also place the
server on a security hold. Findings are advisory evidence, not a replacement
for host-level egress filtering.
"""

from __future__ import annotations

import re
from typing import Any


def _rx(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE | re.MULTILINE)


_RULES: list[dict[str, Any]] = [
    {
        "id": "ddos-tool",
        "label": "DDoS attack tooling",
        "category": "Network abuse",
        "severity": "critical",
        "pattern": _rx(
            r"\b(?:hping3|goldeneye|slowloris|loic|hoic|xerxes|torshammer|"
            r"pyloris|ufonet|mhddos|ddos-ripper|blackenergy)\b"
        ),
    },
    {
        "id": "flood-intent",
        "label": "Packet or request flood",
        "category": "Network abuse",
        "severity": "critical",
        "pattern": _rx(
            r"\b(?:syn|ack|udp|tcp|http|icmp|dns|ntp|ssdp)\s*[-_ ]?\s*flood\b"
            r"|\bpacket\s+flood\b"
            r"|\bflood\s+(?:the\s+)?(?:target|server|host|ip|endpoint|victim)\b"
            r"|\b(?:launch|run|execute|start)\w*\s+(?:a\s+)?(?:ddos|dos)\b"
            r"|\b(?:ddos|dos)\s+(?:attack|tool|script|botnet|panel)\b"
            r"|\b(?:amplification|reflection)\s+attack\b"
        ),
    },
    {
        "id": "stress-tool",
        "label": "Network stress tooling",
        "category": "Network abuse",
        "severity": "critical",
        "pattern": _rx(
            r"\bstress-ng\b[^\n]{0,160}--(?:net|udp|tcp|sctp|dccp)\b"
            r"|\b(?:masscan|zmap|unicornscan)\b"
            r"|\bvegeta\s+attack\b"
            r"|\bab\b[^\n]{0,120}\s-n\s*(?:[1-9]\d{5,})\b"
            r"|\bwrk\b[^\n]{0,120}\s-t\s*[1-9]\d{1,}\b"
            r"|\bhey\b[^\n]{0,120}\s-z\s*\d+[smh]\b"
            r"|\bsiege\b[^\n]{0,120}\s-c\s*[1-9]\d{1,}\b"
        ),
    },
    {
        "id": "scanner",
        "label": "Unauthorised port scanning",
        "category": "Reconnaissance",
        "severity": "warning",
        "pattern": _rx(r"\bnmap\b|\bmasscan\b|\bzmap\b|\bunicornscan\b"),
    },
    {
        "id": "raw-packet",
        "label": "Raw packet attack toolkit",
        "category": "Network abuse",
        "severity": "critical",
        "pattern": _rx(
            r"(?:from\s+scapy|import\s+scapy)[^\n]{0,240}"
            r"|(?:from\s+scapy[^\n]{0,240}\bsendp?\s*\([^\n]{0,240})"
            r"|(?:from\s+scapy[^\n]{0,240}\bsr1?\s*\([^\n]{0,240})"
        ),
    },
    {
        "id": "reverse-shell",
        "label": "Reverse shell payload",
        "category": "Host compromise",
        "severity": "critical",
        "pattern": _rx(
            r"bash\s+-i\s+>&\s*/dev/tcp/"
            r"|/dev/tcp/\d{1,3}(?:\.\d{1,3}){3}/\d{1,5}"
            r"|\bnc\b[^\n]{0,80}\s-e\s+(?:/bin/)?(?:ba)?sh\b"
            r"|\bncat\b[^\n]{0,80}\s-e\s+(?:/bin/)?(?:ba)?sh\b"
            r"|socat[^\n]{0,100}\bexec:"
            r"|\bmeterpreter\b"
        ),
    },
    {
        "id": "destructive-command",
        "label": "Destructive host command",
        "category": "Host integrity",
        "severity": "critical",
        "pattern": _rx(
            r"\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+){1,4}/(?:\s|$|\*)"
            r"|\brm\s+-rf\s+/\*"
            r"|\bmkfs(?:\.[a-z0-9]+)?\b"
            r"|\bdd\s+if=/dev/(?:zero|random|urandom)\s+of=/dev/"
            r"|\b:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"
            r"|\b(?:shutdown|poweroff|halt|reboot)\b(?:\s+-[a-z]+)*\s*(?:now|0|1)?\s*(?:$|[;&|])"
            r"|\biptables\s+-F\b"
            r"|\bnft\s+flush\s+ruleset\b"
            r"|\bchmod\s+-R\s+777\s+/\s*(?:$|;)"
            r"|\bchown\s+-R\s+[^\n]{0,60}\s+/\s*(?:$|;)"
        ),
    },
    {
        "id": "credential-theft",
        "label": "Credential theft or malware",
        "category": "Host compromise",
        "severity": "critical",
        "pattern": _rx(
            r"\b(?:keylogger|credential\s+stealer|browser\s+stealer|"
            r"mimikatz|lsass\s+dump|cryptominer|xmrig)\b"
        ),
    },
]

# Patterns that become a finding only when several suspicious pieces coexist.
_SOCKET_SEND = re.compile(r"\b(?:sendto|sendall|send)\s*\(", re.IGNORECASE)
_SOCKET_LOOP = re.compile(
    r"(?:\bwhile\s+(?:True|1)\b|\bfor\s+\w+\s+in\s+range\s*\([^)]{1,40}\)"
    r"|\bThreadPoolExecutor\b|\bmultiprocessing\b|\bProcessPoolExecutor\b)",
    re.IGNORECASE,
)
_REQUEST_LOOP = re.compile(
    r"(?:\bwhile\s+(?:True|1)\b|\bfor\s+\w+\s+in\s+range\s*\([^)]{2,40}\))",
    re.IGNORECASE,
)
_REQUEST_CALL = re.compile(r"\b(?:requests\.(?:get|post|put|head|request)|httpx\.(?:get|post|put))\s*\(", re.IGNORECASE)
_SLEEP_CALL = re.compile(r"\b(?:time\.)?sleep\s*\(", re.IGNORECASE)
_RAW_SOCKET = re.compile(r"\bSOCK_(?:DGRAM|STREAM|RAW)\b|AF_INET", re.IGNORECASE)
_TCP_LOOP = re.compile(r"/dev/(?:tcp|udp)/[^\s]+", re.IGNORECASE)
_SHELL_LOOP = re.compile(r"\b(?:while|for)\b[^\n]{0,160}\bdo\b", re.IGNORECASE)


def _snippet(text: str, start: int, end: int) -> str:
    left = max(0, start - 80)
    right = min(len(text), end + 80)
    value = re.sub(r"\s+", " ", text[left:right]).strip()
    return value[:240]


def _add(findings: list[dict[str, Any]], rule_id: str, label: str, category: str,
         severity: str, snippet: str) -> None:
    if any(item["id"] == rule_id for item in findings):
        return
    findings.append(
        {
            "id": rule_id,
            "label": label,
            "category": category,
            "severity": severity,
            "snippet": snippet,
        }
    )


def scan_dangerous_activity(text: str | None) -> list[dict[str, Any]]:
    """Return dangerous-activity findings for a command, script or file body."""

    if not text or not text.strip():
        return []
    findings: list[dict[str, Any]] = []
    for rule in _RULES:
        match = rule["pattern"].search(text)
        if match:
            _add(
                findings,
                rule["id"],
                rule["label"],
                rule["category"],
                rule["severity"],
                _snippet(text, match.start(), match.end()),
            )

    # Packet flood code: a raw socket plus a send call inside an unbounded loop.
    if _RAW_SOCKET.search(text) and _SOCKET_SEND.search(text) and _SOCKET_LOOP.search(text):
        match = _SOCKET_SEND.search(text)
        assert match is not None
        _add(
            findings,
            "packet-flood-code",
            "Packet flood code",
            "Network abuse",
            "critical",
            _snippet(text, match.start(), match.end()),
        )

    # Shell /dev/tcp loop, a common bash flood primitive.
    if _TCP_LOOP.search(text) and _SHELL_LOOP.search(text):
        match = _TCP_LOOP.search(text)
        assert match is not None
        _add(
            findings,
            "shell-flood-loop",
            "Shell network flood loop",
            "Network abuse",
            "critical",
            _snippet(text, match.start(), match.end()),
        )

    # Unbounded HTTP request loop without any pacing. This is treated as a
    # warning rather than a security hold, but it is still blocked.
    if _REQUEST_CALL.search(text) and _REQUEST_LOOP.search(text) and not _SLEEP_CALL.search(text):
        match = _REQUEST_CALL.search(text)
        assert match is not None
        _add(
            findings,
            "request-loop",
            "Unbounded request loop",
            "Resource abuse",
            "warning",
            _snippet(text, match.start(), match.end()),
        )

    severity_rank = {"critical": 0, "warning": 1}
    findings.sort(key=lambda item: (severity_rank.get(item["severity"], 2), item["category"]))
    return findings[:4]


def critical_finding(findings: list[dict[str, Any]]) -> dict[str, Any] | None:
    for item in findings:
        if item.get("severity") == "critical":
            return item
    return None


def summary(findings: list[dict[str, Any]]) -> str:
    return ", ".join(item["label"] for item in findings[:3])


TEXT_SUFFIXES = {
    ".py", ".pyw", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sh",
    ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd", ".php", ".rb", ".go",
    ".rs", ".java", ".kt", ".kts", ".lua", ".pl", ".r", ".sql", ".json",
    ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg", ".properties", ".xml",
    ".html", ".htm", ".css", ".scss", ".txt", ".md", ".env", ".service",
    ".timer", ".socket", ".dockerfile", ".mk", ".jar.txt",
}


def is_text_candidate(filename: str, data: bytes) -> bool:
    if len(data) > 2_000_000:
        return False
    suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if suffix in TEXT_SUFFIXES:
        return True
    if b"\x00" in data[:4096]:
        return False
    return True
