"""UGC provider errors."""


class UGCServiceError(Exception):
    """Raised on unrecoverable UGC API failures (after retries are exhausted)."""
