"""LangSmith tracing. No telemetry is sent without a valid LANGSMITH_API_KEY."""
import os
import logging
from functools import wraps

log = logging.getLogger(__name__)


def initialize():
    """Call once, before instrumented app modules are loaded."""
    from dotenv import load_dotenv
    load_dotenv()

    api_key = os.getenv("LANGSMITH_API_KEY") or os.getenv("LANGCHAIN_API_KEY")
    disabled = (
        os.getenv("LANGSMITH_DISABLED", "false").lower() in ("1", "true", "yes")
        or os.getenv("LANGSMITH_TRACING", "true").lower() in ("0", "false", "no")
    )

    if not api_key or disabled:
        os.environ["LANGSMITH_TRACING"] = "false"
        os.environ["LANGCHAIN_TRACING_V2"] = "false"
        log.info("LangSmith observability disabled (no key or tracing disabled)")
        return

    try:
        project = os.getenv("LANGSMITH_PROJECT") or os.getenv("LANGCHAIN_PROJECT") or "vault-ai"
        os.environ["LANGSMITH_TRACING"] = "true"
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGSMITH_API_KEY"] = api_key
        os.environ["LANGCHAIN_API_KEY"] = api_key
        os.environ["LANGSMITH_PROJECT"] = project
        os.environ["LANGCHAIN_PROJECT"] = project

        endpoint = os.getenv("LANGSMITH_ENDPOINT") or os.getenv("LANGCHAIN_ENDPOINT")
        if endpoint:
            os.environ["LANGSMITH_ENDPOINT"] = endpoint

        import langsmith
        log.info("LangSmith observability enabled (project: %s)", project)
    except Exception:
        log.exception("LangSmith initialization failed; application will continue without telemetry")


def trace(name: str):
    """Decorate sync/async functions for LangSmith tracing."""
    def decorate(fn):
        try:
            from langsmith import traceable
            return traceable(name=name)(fn)
        except ImportError:
            return fn
    return decorate
