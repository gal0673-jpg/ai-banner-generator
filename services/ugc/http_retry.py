"""HTTP retry policy for requests-based UGC API calls."""

from __future__ import annotations

import requests
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

_TRANSIENT_HTTP_STATUS = frozenset({408, 429, 500, 502, 503, 504})


def is_transient_http_error(exc: BaseException) -> bool:
    if isinstance(exc, requests.HTTPError):
        return exc.response is not None and exc.response.status_code in _TRANSIENT_HTTP_STATUS
    return isinstance(exc, (requests.ConnectionError, requests.Timeout))


http_retry = retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception(is_transient_http_error),
)
