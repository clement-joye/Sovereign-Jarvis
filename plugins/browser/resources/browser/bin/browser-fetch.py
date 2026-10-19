#!/usr/bin/env python3
"""Fetch one permitted public URL and emit a compact evidence record."""

import json
import ipaddress
import re
import socket
import subprocess
import sys
from datetime import UTC, datetime
from urllib.parse import urljoin, urlparse

from curl_cffi import requests

MAX_BODY_BYTES = 2_000_000
MAX_TEXT_CHARS = 12_000
MAX_REDIRECTS = 5


def fail(message: str) -> None:
    print(json.dumps({"error": message, "fetched_at": datetime.now(UTC).isoformat()}))
    raise SystemExit(1)


def readable_html(html: str) -> str:
    result = subprocess.run(
        ["w3m", "-dump", "-T", "text/html"], input=html, text=True,
        capture_output=True, timeout=10, check=False,
    )
    if result.returncode != 0:
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()
    return result.stdout.strip()


def validate_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("url must use http or https")
    if parsed.username or parsed.password:
        raise ValueError("url credentials are not allowed")
    hostname = (parsed.hostname or "").lower()
    if not hostname or hostname == "localhost" or hostname.endswith(
        (".localhost", ".local", ".internal")
    ):
        raise ValueError("local or internal hostnames are not allowed")
    addresses = {
        item[4][0]
        for item in socket.getaddrinfo(hostname, parsed.port, type=socket.SOCK_STREAM)
    }
    if not addresses:
        raise ValueError("hostname did not resolve")
    for address in addresses:
        parsed_address = ipaddress.ip_address(address)
        if not parsed_address.is_global:
            raise ValueError(f"url resolves to a non-public address: {address}")


def fetch_public_url(url: str):
    current = url
    for redirects in range(MAX_REDIRECTS + 1):
        validate_public_url(current)
        response = requests.get(
            current, impersonate="chrome", timeout=20, allow_redirects=False,
            headers={"Accept": "text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1"},
        )
        if response.status_code not in {301, 302, 303, 307, 308}:
            return response
        if redirects >= MAX_REDIRECTS:
            raise ValueError("too many redirects")
        location = response.headers.get("location")
        if not location:
            raise ValueError("redirect response has no Location header")
        current = urljoin(current, location)
    raise ValueError("too many redirects")


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: browser-fetch.py <http-or-https-url>")
    url = sys.argv[1].strip()
    try:
        response = fetch_public_url(url)
    except Exception as error:
        fail(f"fetch failed: {error}")

    body = response.content
    if len(body) > MAX_BODY_BYTES:
        fail(f"response exceeds {MAX_BODY_BYTES} byte limit")
    content_type = response.headers.get("content-type", "").lower()
    decoded = response.text
    if "json" in content_type:
        try:
            text = json.dumps(response.json(), ensure_ascii=False, indent=2)
        except ValueError:
            text = decoded
    elif "html" in content_type or "xml" in content_type:
        text = readable_html(decoded)
    else:
        text = decoded
    title_match = re.search(r"<title[^>]*>\s*(.*?)\s*</title>", decoded, re.IGNORECASE | re.DOTALL)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""
    print(json.dumps({
        "url": url, "final_url": str(response.url), "status": response.status_code,
        "content_type": content_type, "title": title, "text": text[:MAX_TEXT_CHARS],
        "truncated": len(text) > MAX_TEXT_CHARS,
        "blocked": response.status_code in {401, 403, 429, 451, 503},
        "fetched_at": datetime.now(UTC).isoformat(),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
