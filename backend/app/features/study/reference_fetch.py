"""Fetch the readable text of a public reference page for FACULTY review.

Ported from the v1 reader after review. Security properties:
- http/https only, no credentials in the URL, standard ports only;
- the host is resolved once, every resolved address must be globally routable, and the connection
  is PINNED to that checked address (so DNS cannot be swapped between check and use);
- at most three redirects, each one re-validated from scratch;
- bounded time and size, no compressed bodies, no cookies, only HTML/plain text/PDF.
Students never trigger this: it runs only from a faculty request."""
import socket
import ssl
from html.parser import HTMLParser
from http.client import HTTPConnection, HTTPSConnection
from http.client import HTTPException as HTTPProtocolError
from io import BytesIO
from ipaddress import ip_address
from urllib.parse import urljoin, urlsplit

from pypdf import PdfReader

MAX_PAGE_BYTES = 1_500_000
MAX_PAGE_CHARS = 30_000
MAX_URL_CHARS = 2048
TIMEOUT = 7
ALLOWED_PORTS = {"http": 80, "https": 443}
BLOCKED_TAGS = {"script", "style", "noscript", "svg", "nav", "footer", "header"}


class ReferenceFetchError(ValueError):
    """Message is safe to show to faculty."""


class _Readable(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.open, self.parts = [], []

    def handle_starttag(self, tag, attrs):
        self.open.append(tag)

    def handle_endtag(self, tag):
        if tag in self.open:
            self.open = self.open[:len(self.open) - 1 - self.open[::-1].index(tag)]
        if tag in {"p", "li", "h1", "h2", "h3", "h4", "tr", "br", "div"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not any(t in BLOCKED_TAGS for t in self.open) and data.strip():
            self.parts.append(data.strip())


class _PinnedHTTPS(HTTPSConnection):
    def __init__(self, hostname, address, port):
        super().__init__(hostname, port, timeout=TIMEOUT, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        self.sock = socket.create_connection((self.address, self.port), timeout=TIMEOUT)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def public_address(hostname, port):
    try:
        answers = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
        addresses = {a[4][0] for a in answers}
    except OSError as error:
        raise ReferenceFetchError("The reference website could not be found.") from error
    if not addresses or any(not ip_address(a).is_global for a in addresses):
        raise ReferenceFetchError("Reference links must point to public websites.")
    return min(addresses)


def _decode(data, charset):
    try:
        return data.decode(charset, errors="replace")
    except LookupError:
        return data.decode("utf-8", errors="replace")


def readable_text(data, content_type, charset):
    if content_type == "application/pdf":
        try:
            text = "\n".join((page.extract_text() or "") for page in PdfReader(BytesIO(data)).pages[:30])
        except (ValueError, KeyError, OSError) as error:
            raise ReferenceFetchError("The linked PDF could not be read.") from error
    elif content_type in {"text/html", "application/xhtml+xml"}:
        parser = _Readable()
        parser.feed(_decode(data, charset))
        text = "\n".join(p for p in " ".join(parser.parts).split("\n"))
    elif content_type == "text/plain":
        text = _decode(data, charset)
    else:
        raise ReferenceFetchError("The link must be a web page, plain text or PDF.")
    lines = [" ".join(line.split()) for line in text.splitlines()]
    text = "\n".join(line for line in lines if line)
    if len(text) < 80:
        raise ReferenceFetchError("There is too little readable text at this link. Paste the "
                                  "relevant text yourself instead.")
    return text[:MAX_PAGE_CHARS]


def fetch_reference_text(url):
    """Readable text at a public URL, or ReferenceFetchError."""
    current = url
    for _ in range(4):
        if len(current) > MAX_URL_CHARS:
            raise ReferenceFetchError("The link is too long.")
        try:
            parsed = urlsplit(current)
            port = parsed.port or ALLOWED_PORTS.get(parsed.scheme, 0)
        except ValueError as error:
            raise ReferenceFetchError("The link is not valid.") from error
        if parsed.scheme not in ALLOWED_PORTS or not parsed.hostname or parsed.username \
                or parsed.password:
            raise ReferenceFetchError("Use a public http or https link.")
        if port != ALLOWED_PORTS[parsed.scheme]:
            raise ReferenceFetchError("Links must use the standard web port.")
        address = public_address(parsed.hostname, port)
        connection = (_PinnedHTTPS(parsed.hostname, address, port) if parsed.scheme == "https"
                      else HTTPConnection(address, port, timeout=TIMEOUT))
        path = (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
        try:
            connection.request("GET", path, headers={
                "Host": parsed.hostname, "User-Agent": "LearnSync/2 (faculty reference reader)",
                "Accept": "text/html, text/plain, application/pdf", "Accept-Encoding": "identity"})
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location:
                    raise ReferenceFetchError("The link redirected without a destination.")
                current = urljoin(current, location)
                continue
            if response.status != 200:
                raise ReferenceFetchError(f"The website answered with an error ({response.status}).")
            try:
                declared = int(response.getheader("Content-Length") or 0)
            except ValueError as error:
                raise ReferenceFetchError("The website sent an invalid response.") from error
            if declared > MAX_PAGE_BYTES:
                raise ReferenceFetchError("The page is too large to read.")
            if (response.getheader("Content-Encoding") or "identity").lower() != "identity":
                raise ReferenceFetchError("The website sent compressed content that cannot be read.")
            data = response.read(MAX_PAGE_BYTES + 1)
            if len(data) > MAX_PAGE_BYTES:
                raise ReferenceFetchError("The page is too large to read.")
            content_type = response.headers.get_content_type().lower()
            return readable_text(data, content_type, response.headers.get_content_charset("utf-8"))
        except (OSError, HTTPProtocolError) as error:
            raise ReferenceFetchError("The website could not be reached securely.") from error
        finally:
            connection.close()
    raise ReferenceFetchError("The link redirected too many times.")
