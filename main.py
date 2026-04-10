"""
Crawl up to 10 unique internal pages; save title and <p> text to scraped_content.txt.
Skips legal/accessibility junk links; downloads homepage logo to logo.png.
Uses Selenium (headless Chrome) for JS-rendered sites (WordPress, Shopify, SPAs, custom stacks).
Requires: pip install selenium requests pillow openai
Chrome must be installed; Selenium Manager resolves ChromeDriver automatically.
After crawl, if OPENAI_API_KEY is set and logo.png exists, runs creative_agent: OpenAI JSON,
DALL-E background.png, and creative_campaign.json (no HTML/screenshot step).
"""
from __future__ import annotations

import io
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections import deque
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse, urlunparse

import requests
from PIL import Image, UnidentifiedImageError
from selenium.common.exceptions import (  # type: ignore[import-untyped]
    ElementClickInterceptedException,
    NoAlertPresentException,
    NoSuchWindowException,
    TimeoutException,
    UnexpectedAlertPresentException,
    WebDriverException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

BASE_DIR = Path(__file__).resolve().parent
MAX_PAGES = 10
OUTPUT_FILE = BASE_DIR / "scraped_content.txt"
LOGO_FILE = BASE_DIR / "logo.png"
SEPARATOR = "=" * 80
RENDER_WAIT_SECONDS = 10

# Hard timeouts so a single problematic page can't hang Celery indefinitely.
PAGE_LOAD_TIMEOUT_SECONDS = 35
SCRIPT_TIMEOUT_SECONDS = 25
DOM_READY_TIMEOUT_SECONDS = 20

# Lightweight (httpx + BeautifulSoup) scraping thresholds.
# Pages whose total <p> character count or meaningful paragraph count fall below
# these limits are classified as JS-rendered SPAs and trigger a Chrome fallback.
HTTPX_TIMEOUT_SECONDS = 15.0
SPA_MIN_TOTAL_CHARS = 300
SPA_MIN_MEANINGFUL_PARAS = 3

# ── Active Chrome driver registry ──────────────────────────────────────────────
# build_headless_chrome() registers every driver here so external callers
# (Celery signal handlers, atexit hooks) can force-quit Chrome on hard exits.
_active_drivers: set = set()


def _kill_uc_browser_process_tree(pid: int | None) -> None:
    """Kill only the browser process tree spawned for this driver (undetected-chromedriver sets ``browser_pid``)."""
    if not pid:
        return
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True,
                timeout=15,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        else:
            os.kill(pid, 9)  # SIGKILL
    except Exception:
        pass


def quit_all_active_drivers() -> None:
    """Force-quit every Chrome instance known to this process. Safe to call multiple times."""
    for drv in list(_active_drivers):
        _uc_profile = getattr(drv, "_banner_uc_profile_dir", None)
        # Capture PIDs before teardown — uc may clear attributes during quit().
        browser_pid: int | None = getattr(drv, "browser_pid", None)
        chromedriver_pid: int | None = getattr(drv, "_banner_chromedriver_pid", None)

        # Kill browser first, then chromedriver (undetected-chromedriver often leaves chromedriver.exe up).
        _kill_uc_browser_process_tree(browser_pid)
        _kill_uc_browser_process_tree(chromedriver_pid)

        try:
            drv.quit()
        except Exception:
            pass

        if _uc_profile:
            try:
                shutil.rmtree(_uc_profile, ignore_errors=True)
            except Exception:
                pass

    _active_drivers.clear()

# Case-insensitive for ASCII; Hebrew phrases matched as literal substrings.
JUNK_KEYWORDS = (
    "privacy",
    "terms",
    "policy",
    "accessibility",
    "cookie",
    "תקנון",
    "פרטיות",
    "נגישות",
    "תנאי שימוש",
)

def _chrome_major_from_executable(exe: str) -> int | None:
    """Parse major version from ``chrome --version`` / ``chromium --version``."""
    if not exe or not os.path.isfile(exe):
        return None
    kw: dict = {
        "capture_output": True,
        "text": True,
        "timeout": 20,
    }
    if sys.platform == "win32":
        kw["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        out = subprocess.run([exe, "--version"], **kw)
        line = (out.stdout or out.stderr or "").strip()
        m = re.search(r"(?:Chrome|Chromium|Microsoft Edge)\s+(\d+)\.", line, re.I)
        if not m:
            m = re.search(r"(\d+)\.", line)
        if m:
            major = int(m.group(1))
            if 50 <= major <= 300:
                return major
    except (OSError, subprocess.TimeoutExpired):
        pass
    return None


def _chrome_major_from_registry_windows() -> int | None:
    import winreg

    for root, subkey in (
        (winreg.HKEY_CURRENT_USER, r"Software\Google\Chrome\BLBeacon"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Google\Chrome\BLBeacon"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Google\Chrome\BLBeacon"),
    ):
        try:
            with winreg.OpenKey(root, subkey) as key:
                ver, _ = winreg.QueryValueEx(key, "version")
            major = int(str(ver).split(".", 1)[0])
            if 50 <= major <= 300:
                return major
        except OSError:
            continue
    return None


def clear_undetected_chromedriver_cache() -> None:
    """Remove cached chromedriver binaries (stale cache causes wrong major vs browser)."""
    roots: list[Path] = []
    for base in (
        os.path.expandvars(r"%APPDATA%\undetected_chromedriver"),
        os.path.expandvars(r"%LOCALAPPDATA%\undetected_chromedriver"),
        Path.home() / "AppData" / "Roaming" / "undetected_chromedriver",
    ):
        if not base:
            continue
        roots.append(Path(base))
    seen: set[str] = set()
    for p in roots:
        try:
            key = str(p.resolve())
        except OSError:
            key = str(p)
        if key in seen:
            continue
        seen.add(key)
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)


def resolve_chrome_for_uc() -> tuple[str | None, int | None]:
    """
    Return ``(browser_executable_path, version_main)`` for undetected-chromedriver.

    Prefer the real binary's ``--version`` over the Registry (they can disagree).

    Env:
    - ``CHROME_BINARY`` / ``GOOGLE_CHROME_BIN``: path to chrome/chromium exe
    - ``CHROME_MAJOR_VERSION``: force major (int), e.g. 116
    - ``UC_CLEAR_DRIVER_CACHE``: if ``1``/``true``, delete undetected-chromedriver cache dirs before start
    - ``UC_PATCHER_FORCE_CLOSE``: default ``1`` on Windows — kill locking ``chromedriver`` so a fresh
      driver can replace a stale binary (undetected-chromedriver otherwise reuses driver 117 while Chrome is 116).
      Set to ``0`` to disable.
    """
    flag = os.environ.get("UC_CLEAR_DRIVER_CACHE", "").strip().lower()
    if flag in ("1", "true", "yes"):
        clear_undetected_chromedriver_cache()

    raw_major = os.environ.get("CHROME_MAJOR_VERSION", "").strip()
    major_override = int(raw_major) if raw_major.isdigit() and 50 <= int(raw_major) <= 300 else None

    env_bin = (
        os.environ.get("CHROME_BINARY", "").strip()
        or os.environ.get("GOOGLE_CHROME_BIN", "").strip()
    )
    if env_bin:
        env_bin = os.path.normpath(env_bin)
        if os.path.isfile(env_bin):
            maj = _chrome_major_from_executable(env_bin)
            return env_bin, major_override or maj
        if major_override is not None:
            return None, major_override

    if sys.platform == "win32":
        # User-level Chrome is usually the one that runs / updates; check it before Program Files.
        for exe in (
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Chromium\Application\chromium.exe"),
        ):
            if not os.path.isfile(exe):
                continue
            maj = _chrome_major_from_executable(exe)
            if maj is not None:
                return os.path.normpath(exe), major_override or maj

        reg_maj = _chrome_major_from_registry_windows()
        if reg_maj is not None:
            return None, major_override or reg_maj
        return None, major_override

    if sys.platform == "darwin":
        for exe in (
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ):
            if os.path.isfile(exe):
                maj = _chrome_major_from_executable(exe)
                if maj is not None:
                    return exe, major_override or maj
        return None, major_override

    for cmd in ("google-chrome-stable", "google-chrome", "chromium", "chromium-browser"):
        pth = shutil.which(cmd)
        if not pth:
            continue
        maj = _chrome_major_from_executable(pth)
        if maj is not None:
            return pth, major_override or maj
    return None, major_override


REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}


def normalize_url(url: str) -> str:
    """Add https:// when no scheme is given."""
    url = url.strip()
    while url.startswith("/"):
        url = url[1:]
    if not url:
        return url
    parsed = urlparse(url)
    if not parsed.scheme:
        return "https://" + url
    return url


def strip_fragment(url: str) -> str:
    """Remove #fragment for stable deduplication."""
    p = urlparse(url)
    return urlunparse((p.scheme, p.netloc, p.path or "/", p.params, p.query, ""))


def same_site(url: str, base_netloc: str) -> bool:
    """True if url is http(s) and host matches the crawl root (internal link)."""
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        return False
    return p.netloc.lower() == base_netloc.lower()


def link_contains_junk(url: str, anchor_text: str) -> bool:
    """
    True if URL (decoded) or visible anchor/label text should be excluded from crawl.
    English keywords: case-insensitive. Hebrew: substring match on decoded URL and anchor.
    """
    decoded_url = unquote(url)
    haystacks = (
        decoded_url.lower(),
        anchor_text.lower(),
        decoded_url,
        anchor_text,
    )
    for kw in JUNK_KEYWORDS:
        if not kw:
            continue
        ascii_kw = kw.isascii()
        for h in haystacks:
            if ascii_kw:
                if kw in h.lower():
                    return True
            else:
                if kw in h:
                    return True
    return False


def format_page_block(page_url: str, title: str, paragraphs: list[str]) -> str:
    """One nicely separated section for the output file."""
    lines = [
        SEPARATOR,
        f"URL: {page_url}",
        SEPARATOR,
        f"Title: {title}",
        "",
        "Paragraphs (<p>):",
    ]
    if paragraphs:
        lines.append("")
        lines.append("\n\n".join(paragraphs))
    else:
        lines.append("(no <p> tags with text found)")
    lines.append("")
    lines.append("")
    return "\n".join(lines)


def _patch_real_chrome_local_state() -> None:
    """
    Patch the real Chrome installation's Local State file to disable the
    'Show profile picker on startup' checkbox.  This is the only reliable way
    to suppress the picker when the user has the checkbox ticked inside Chrome.
    """
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if not local_app_data:
        return

    chrome_local_state_path = os.path.join(
        local_app_data, "Google", "Chrome", "User Data", "Local State"
    )
    if not os.path.exists(chrome_local_state_path):
        return

    try:
        with open(chrome_local_state_path, "r", encoding="utf-8") as f:
            state = json.load(f)

        changed = False

        profile_section = state.setdefault("profile", {})
        if profile_section.get("picker_shown_on_startup") is not False:
            profile_section["picker_shown_on_startup"] = False
            changed = True

        browser_section = state.setdefault("browser", {})
        if browser_section.get("show_profile_chooser_on_startup") is not False:
            browser_section["show_profile_chooser_on_startup"] = False
            changed = True

        if changed:
            with open(chrome_local_state_path, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
    except Exception:
        pass


def _seed_chrome_profile(profile_dir: str) -> None:
    """
    Pre-populate a fresh Chrome user-data-dir so Chrome treats it as an existing profile.
    This suppresses the profile-picker / first-run dialogs on Windows multi-profile installs.
    """
    default_dir = os.path.join(profile_dir, "Default")
    os.makedirs(default_dir, exist_ok=True)

    local_state = {
        "profile": {
            "profiles_order": ["Default"],
            "last_used": "Default",
            "picker_shown_on_startup": False,
            "profile_counts_reported": 1,
            "info_cache": {
                "Default": {
                    "name": "Default",
                    "is_using_default_name": True,
                }
            },
        },
        "browser": {
            "has_seen_welcome_page": True,
            "show_profile_chooser_on_startup": False,
            "enabled_labs_experiments": [],
        },
        "user_manager": {
            "shown_count": 1,
            "serial_number_salt": "0",
        },
    }
    with open(os.path.join(profile_dir, "Local State"), "w", encoding="utf-8") as f:
        json.dump(local_state, f)

    preferences = {
        "profile": {
            "exit_type": "Normal",
            "exited_cleanly": True,
            "name": "Default",
        },
        "browser": {
            "has_seen_welcome_page": True,
        },
        "session": {
            "restore_on_startup": 1,
        },
    }
    with open(os.path.join(default_dir, "Preferences"), "w", encoding="utf-8") as f:
        json.dump(preferences, f)


def build_headless_chrome() -> WebDriver:
    """
    Undetected Chrome driver (stealthier than stock Selenium) with hard timeouts.
    Keep this function signature stable: other modules import it indirectly.
    """
    try:
        # Python 3.12+ removed stdlib distutils; undetected-chromedriver still imports it.
        # setuptools vendors a compatible distutils — import it before uc.
        import setuptools  # noqa: F401
    except ModuleNotFoundError:
        pass

    try:
        import undetected_chromedriver as uc
    except ModuleNotFoundError as exc:
        py = sys.executable
        missing = getattr(exc, "name", "") or ""
        if missing == "distutils" or "distutils" in str(exc):
            raise RuntimeError(
                "בגרסת Python שלך הוסר המודול distutils מהספרייה הסטנדרטית, "
                "וב־undetected-chromedriver עדיין נעשה בו שימוש. "
                f'נסה קודם: "{py}" -m pip install -U setuptools '
                "ואז הרץ שוב. אם עדיין נכשל — מומלץ venv עם Python 3.11 או 3.12 (יציב יותר עם Selenium/Chrome)."
            ) from exc
        raise RuntimeError(
            "חסרה חבילת undetected-chromedriver בסביבת ה-Python שמריצה את משימת ה-crawl (בדרך כלל Celery). "
            f'התקן לאותו מפרש שמריץ את ה-worker: "{py}" -m pip install undetected-chromedriver '
            "(או: pip install -r requirements.txt מאותה סביבה)."
        ) from exc

    options = uc.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--lang=en-US,en")
    options.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    )
    options.add_argument("--disable-blink-features=AutomationControlled")
    # Suppress Chrome's profile-picker / "Who's using Chrome?" dialog on Windows.
    options.add_argument("--bwsi")
    options.add_argument("--disable-features=NewProfilePicker,ProfileManagement")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--no-first-run")

    browser_path, version_main = resolve_chrome_for_uc()
    # use_subprocess=False on Windows: let chromedriver own the browser lifecycle (fewer orphan GUIs).
    _us = os.environ.get("UC_USE_SUBPROCESS", "").strip().lower()
    if _us in ("1", "true", "yes"):
        _use_sub = True
    elif _us in ("0", "false", "no"):
        _use_sub = False
    else:
        _use_sub = sys.platform != "win32"

    driver_kwargs: dict = {"options": options, "use_subprocess": _use_sub}
    if browser_path:
        driver_kwargs["browser_executable_path"] = browser_path
    # uc: version_main=0 is treated as "auto" → downloads latest Stable driver (wrong if Chrome is older).
    if version_main is not None and int(version_main) > 0:
        driver_kwargs["version_main"] = int(version_main)

    # undetected_chromedriver: if chromedriver.exe is locked, patcher reuses old binary without re-fetch.
    # Default force-close on Windows so CHROME_MAJOR_VERSION / detection can actually apply.
    _pfc = os.environ.get("UC_PATCHER_FORCE_CLOSE", "1" if sys.platform == "win32" else "0").strip().lower()
    driver_kwargs["patcher_force_close"] = _pfc not in ("0", "false", "no")

    # Explicitly tell uc.Chrome to launch in headless mode at the driver level,
    # in addition to the --headless=new ChromeOption.  Some uc versions ignore the
    # ChromeOption and open a visible window unless headless=True is passed here.
    driver_kwargs["headless"] = True

    # Disable the "Show at startup" checkbox in the real Chrome installation.
    _patch_real_chrome_local_state()

    # Fresh user-data-dir per run (``mkdtemp`` guarantees uniqueness); never reuse the
    # default Chrome profile so automation stays isolated from personal browser windows.
    profile_dir = tempfile.mkdtemp(prefix="banner_crawl_uc_")
    _seed_chrome_profile(profile_dir)
    driver_kwargs["user_data_dir"] = profile_dir
    options.add_argument("--profile-directory=Default")

    try:
        driver = uc.Chrome(**driver_kwargs)
    except Exception:
        shutil.rmtree(profile_dir, ignore_errors=True)
        raise

    try:
        svc = getattr(driver, "service", None)
        proc = getattr(svc, "process", None) if svc is not None else None
        _cdp = getattr(proc, "pid", None) if proc is not None else None
        if _cdp:
            setattr(driver, "_banner_chromedriver_pid", int(_cdp))
    except Exception:
        pass

    # If headless failed partially on Windows, move any visible window off-screen.
    if sys.platform == "win32":
        try:
            driver.set_window_position(-3200, -3200)
        except Exception:
            pass

    driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT_SECONDS)
    driver.set_script_timeout(SCRIPT_TIMEOUT_SECONDS)
    setattr(driver, "_banner_uc_profile_dir", profile_dir)
    _active_drivers.add(driver)
    return driver


def _safe_dismiss_alerts(driver: WebDriver) -> None:
    """Best-effort close of unexpected JS alerts that can block navigation/extraction."""
    try:
        alert = driver.switch_to.alert
    except (WebDriverException, NoSuchWindowException, NoAlertPresentException):
        return
    try:
        alert.dismiss()
    except WebDriverException:
        try:
            alert.accept()
        except WebDriverException:
            return


def _wait_dom_ready(driver: WebDriver, timeout_s: int) -> None:
    """Wait for DOM to be ready; does not require full network idle."""
    WebDriverWait(driver, timeout_s).until(
        lambda d: (d.execute_script("return document.readyState") or "") in ("interactive", "complete")
    )


def _auto_dismiss_cookie_banners(driver: WebDriver) -> None:
    """
    Heuristic cookie/consent dismissal to reduce boilerplate in extracted <p> text.
    Safe: best-effort only; never hard-fails the crawl.
    """
    try:
        # Some banners are injected after initial load.
        time.sleep(0.5)
    except Exception:
        pass

    # Common CMP/framework selectors (OneTrust, Cookiebot, etc.) plus generic "accept" buttons.
    selector_candidates = [
        "#onetrust-accept-btn-handler",
        "button#onetrust-accept-btn-handler",
        "button[aria-label*='accept' i]",
        "button[aria-label*='agree' i]",
        "button[id*='accept' i]",
        "button[class*='accept' i]",
        "button[class*='consent' i]",
        "button[id*='consent' i]",
        "button",
        "input[type='button']",
        "input[type='submit']",
        "a[role='button']",
    ]

    acceptish = (
        "accept",
        "agree",
        "allow",
        "allow all",
        "ok",
        "got it",
        "i understand",
        "continue",
        "yes",
        # Hebrew (common variants)
        "אישור",
        "מאשר",
        "מסכים",
        "מסכימ",
        "הסכמ",
        "אפשר",
        "קבל",
        "המשך",
    )

    def _looks_like_accept(el) -> bool:
        try:
            txt = ((el.text or "") + " " + (el.get_attribute("aria-label") or "")).strip()
            if not txt:
                txt = (el.get_attribute("value") or "").strip()
            blob = txt.lower()
            return any(k in blob for k in acceptish) or any(k in txt for k in acceptish if not k.isascii())
        except WebDriverException:
            return False

    clicked = 0
    seen_ids: set[str] = set()
    for sel in selector_candidates:
        if clicked >= 3:
            break
        try:
            els = driver.find_elements(By.CSS_SELECTOR, sel)
        except WebDriverException:
            continue
        for el in els[:25]:
            if clicked >= 3:
                break
            try:
                if el.id in seen_ids:
                    continue
                seen_ids.add(el.id)
                if not el.is_displayed() or not el.is_enabled():
                    continue
                if not _looks_like_accept(el):
                    continue
                try:
                    el.click()
                except (ElementClickInterceptedException, WebDriverException):
                    # JS click is often more reliable for overlayed dialogs.
                    driver.execute_script("arguments[0].click();", el)
                clicked += 1
                # Give the DOM a moment to remove the overlay.
                time.sleep(0.25)
            except WebDriverException:
                continue


def run_agency_banner_pipeline(
    work_dir: Path | None = None,
    site_url: str = "",
) -> None:
    """
    GPT-4o + DALL-E 3 (via creative_agent): writes creative_campaign.json,
    background.png, and uses existing logo.png.  After that it renders a
    two high-quality PNGs (``rendered_banner_1.png``, ``rendered_banner_2.png``) via html_renderer.

    If ``work_dir`` is set, all artifacts live under that directory (for API jobs).
    When ``work_dir`` is set, missing scraped content or logo raises ``RuntimeError``.
    """
    from openai import OpenAI

    from creative_agent import fetch_banner_payload, generate_background_dalle3
    from html_renderer import render_design_1_html, render_design_2_html, render_html_to_png

    root = work_dir if work_dir is not None else BASE_DIR
    output_file = root / "scraped_content.txt"
    logo_file = root / "logo.png"
    background_png = root / "background.png"
    campaign_json = root / "creative_campaign.json"
    banner_html_1 = root / "banner_temp_design1.html"
    banner_html_2 = root / "banner_temp_design2.html"
    rendered_banner_1 = root / "rendered_banner_1.png"
    rendered_banner_2 = root / "rendered_banner_2.png"

    if work_dir is not None:
        work_dir.mkdir(parents=True, exist_ok=True)

    if not output_file.is_file() or not output_file.read_text(encoding="utf-8").strip():
        msg = "Agency banner: skipped (no scraped content)."
        if work_dir is not None:
            raise RuntimeError(msg)
        print(msg, file=sys.stderr)
        return
    if not logo_file.is_file():
        msg = (
            "Agency banner: skipped (logo.png missing; homepage logo was not saved)."
        )
        if work_dir is not None:
            raise RuntimeError(msg)
        print(msg, file=sys.stderr)
        return

    print("Agency banner: requesting copy + generating background (OpenAI)...")
    client = OpenAI()
    user_content = output_file.read_text(encoding="utf-8")
    payload = fetch_banner_payload(client, user_content)
    generate_background_dalle3(
        client, str(payload["image_prompt"]), output_path=background_png
    )

    with campaign_json.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    if not background_png.is_file():
        err = "background.png was not created."
        if work_dir is not None:
            raise RuntimeError(err)
        print(f"[main] ERROR: {err}", file=sys.stderr)
        return

    print(f"Agency banner: saved {campaign_json.name} and {background_png.name}")

    # ── High-quality PNGs (Design 1 + Design 2 HTML → PNG) ─────────────────────
    print("Agency banner: rendering PNGs (html_renderer + headless Chrome)…")
    try:
        render_design_1_html(
            payload,
            background_path=background_png,
            logo_path=logo_file,
            output_path=banner_html_1,
            site_url=site_url,
        )
        render_design_2_html(
            payload,
            background_path=background_png,
            logo_path=logo_file,
            output_path=banner_html_2,
            site_url=site_url,
        )
        render_html_to_png(banner_html_1, rendered_banner_1)
        render_html_to_png(banner_html_2, rendered_banner_2)
        print(
            f"Agency banner: saved {rendered_banner_1.name} and {rendered_banner_2.name} "
            f"to {root}"
        )
    except Exception as exc:  # noqa: BLE001
        print(
            f"[main] WARNING: rendered banner PNGs failed ({exc}). Continuing without them.",
            file=sys.stderr,
        )


def extract_title_and_paragraphs(driver: WebDriver) -> tuple[str, list[str]]:
    """Return document title and non-empty stripped text from all <p> elements in the live DOM."""
    title_text = (driver.title or "").strip()
    if not title_text:
        title_text = "(no title found)"

    paras = driver.find_elements(By.TAG_NAME, "p")
    texts: list[str] = []
    for p in paras:
        t = (p.text or "").strip()
        if t:
            texts.append(t)
    return title_text, texts


def _anchor_label(el) -> str:
    parts = [
        (el.text or "").strip(),
        (el.get_attribute("aria-label") or "").strip(),
        (el.get_attribute("title") or "").strip(),
    ]
    return " ".join(p for p in parts if p)


def discover_internal_links(driver: WebDriver, base_host: str) -> list[str]:
    """Same-site http(s) hrefs only; skip junk URLs and junk anchor text (blocklist)."""
    current = driver.current_url
    found: list[str] = []
    for el in driver.find_elements(By.CSS_SELECTOR, "a[href]"):
        href = el.get_attribute("href")
        if not href:
            continue
        absolute = strip_fragment(urljoin(current, href))
        if not same_site(absolute, base_host):
            continue
        label = _anchor_label(el)
        if link_contains_junk(absolute, label):
            continue
        found.append(absolute)
    return found


def _resolve_img_url(driver: WebDriver, img) -> str | None:
    """Best-effort absolute image URL from src, lazy attrs, or srcset."""
    base = driver.current_url
    src = (img.get_attribute("src") or "").strip()
    if src.startswith("data:"):
        src = ""
    if not src:
        for attr in ("data-src", "data-lazy-src", "data-original", "data-srcset"):
            v = (img.get_attribute(attr) or "").strip()
            if v and not v.startswith("data:"):
                src = v
                break
    if not src:
        srcset = (img.get_attribute("srcset") or "").strip()
        if srcset:
            first = srcset.split(",")[0].strip()
            src = first.split()[0] if first else ""
    if not src or src.startswith("data:"):
        return None
    return urljoin(base, src)


def _img_element_priority(img) -> int:
    """Higher = stronger logo candidate."""
    score = 0
    try:
        if img.find_elements(By.XPATH, "./ancestor::header"):
            score += 100
        if img.find_elements(By.XPATH, "./ancestor::nav"):
            score += 90
    except WebDriverException:
        pass

    cls = (img.get_attribute("class") or "").lower()
    eid = (img.get_attribute("id") or "").lower()
    alt = (img.get_attribute("alt") or "").lower()
    src = (img.get_attribute("src") or "").lower()
    blob = f"{cls} {eid} {alt} {src}"
    if "custom-logo" in cls or "site-logo" in cls:
        score += 85
    if "logo" in blob:
        score += 50

    try:
        w = img.size.get("width", 0)
        h = img.size.get("height", 0)
        if w >= 80 and h >= 24:
            score += 20
        elif w < 16 or h < 16:
            score -= 50
    except WebDriverException:
        pass

    return score


def extract_and_save_homepage_logo(driver: WebDriver, logo_file: Path) -> bool:
    """
    Heuristic logo detection (header/nav, logo in attributes, custom-logo / site-logo).
    Download with requests; save as RGBA PNG for correct transparency.
    """
    imgs: list = []
    seen_ids: set[str] = set()

    xpaths = [
        "//header//img",
        "//nav//img",
        "//*[contains(translate(@class,'LOGO','logo'),'logo')]//img",
        "//img[contains(translate(@class,'LOGO','logo'),'logo')]",
        "//*[contains(@class,'custom-logo')]//img",
        "//img[contains(@class,'custom-logo')]",
        "//*[contains(@class,'site-logo')]//img",
        "//img[contains(@class,'site-logo')]",
    ]
    for xp in xpaths:
        try:
            for img in driver.find_elements(By.XPATH, xp):
                eid = img.id
                if eid in seen_ids:
                    continue
                seen_ids.add(eid)
                imgs.append(img)
        except WebDriverException:
            continue

    for img in driver.find_elements(By.TAG_NAME, "img"):
        eid = img.id
        if eid in seen_ids:
            continue
        attrs = " ".join(
            filter(
                None,
                [
                    img.get_attribute("class"),
                    img.get_attribute("id"),
                    img.get_attribute("src"),
                    img.get_attribute("alt"),
                ],
            )
        ).lower()
        if "logo" in attrs:
            seen_ids.add(eid)
            imgs.append(img)

    scored: list[tuple[int, object]] = [(_img_element_priority(im), im) for im in imgs]
    scored.sort(key=lambda x: -x[0])

    tried_urls: set[str] = set()
    for _pri, img in scored:
        url = _resolve_img_url(driver, img)
        if not url:
            continue
        if urlparse(url).scheme not in ("http", "https"):
            continue
        if url in tried_urls:
            continue
        tried_urls.add(url)
        try:
            r = requests.get(url, timeout=45, headers=REQUEST_HEADERS)
            r.raise_for_status()
            if len(r.content) < 80:
                continue
            try:
                im = Image.open(io.BytesIO(r.content))
                im = im.convert("RGBA")
                im.save(logo_file, format="PNG", optimize=True)
                print(f"Saved homepage logo to {logo_file}")
                return True
            except (UnidentifiedImageError, OSError, ValueError):
                continue
        except requests.RequestException:
            continue

    print("Warning: could not detect or download a homepage logo (logo.png not written).")
    return False


# ── Lightweight scraping helpers (httpx + BeautifulSoup) ─────────────────────


def _lightweight_fetch_page(
    url: str,
) -> "tuple[str, list[str], Any, str]":
    """
    Fetch *url* with httpx (no JavaScript execution) and parse with BeautifulSoup.

    Returns ``(title, paragraphs, soup, final_url)``.  Raises on HTTP errors or if
    the optional dependencies (httpx, beautifulsoup4) are not installed.
    """
    import httpx
    from bs4 import BeautifulSoup

    lw_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    with httpx.Client(
        follow_redirects=True,
        timeout=HTTPX_TIMEOUT_SECONDS,
        headers=lw_headers,
    ) as client:
        resp = client.get(url)
        resp.raise_for_status()
        final_url = strip_fragment(str(resp.url))
        html = resp.text

    soup = BeautifulSoup(html, "html.parser")

    title_tag = soup.find("title")
    title = (title_tag.get_text(strip=True) if title_tag else "") or "(no title found)"

    paragraphs: list[str] = []
    for p_tag in soup.find_all("p"):
        text = p_tag.get_text(separator=" ", strip=True)
        if text:
            paragraphs.append(text)

    return title, paragraphs, soup, final_url


def _is_content_sparse(paragraphs: list[str]) -> bool:
    """
    Return True when ``<p>`` text volume is too thin for a properly rendered static page —
    the canonical signal that we are looking at a JS-rendered SPA shell.

    Both thresholds must be satisfied to avoid false positives on legitimate short pages.
    """
    total_chars = sum(len(p) for p in paragraphs)
    meaningful = sum(1 for p in paragraphs if len(p) > 20)
    return total_chars < SPA_MIN_TOTAL_CHARS or meaningful < SPA_MIN_MEANINGFUL_PARAS


def _extract_logo_from_soup(soup: "Any", base_url: str, logo_file: Path) -> bool:
    """
    Heuristic logo detection from a static BeautifulSoup parse tree.
    Mirrors :func:`extract_and_save_homepage_logo` but operates without a live WebDriver.
    """
    scored: list[tuple[int, str]] = []

    for img in soup.find_all("img"):
        src = (
            img.get("src")
            or img.get("data-src")
            or img.get("data-lazy-src")
            or img.get("data-original")
            or ""
        )
        if not src or src.startswith("data:"):
            continue

        abs_url = urljoin(base_url, src)
        if urlparse(abs_url).scheme not in ("http", "https"):
            continue

        attrs_blob = " ".join(
            filter(
                None,
                [
                    " ".join(img.get("class") or []),
                    img.get("id", ""),
                    img.get("alt", ""),
                    src,
                ],
            )
        ).lower()

        score = 0
        parent_names = [
            getattr(p, "name", None) for p in img.parents if getattr(p, "name", None)
        ]
        if "header" in parent_names:
            score += 100
        if "nav" in parent_names:
            score += 90
        if "custom-logo" in attrs_blob or "site-logo" in attrs_blob:
            score += 85
        if "logo" in attrs_blob:
            score += 50

        scored.append((score, abs_url))

    scored.sort(key=lambda x: -x[0])
    seen_urls: set[str] = set()
    for _score, img_url in scored:
        if img_url in seen_urls:
            continue
        seen_urls.add(img_url)
        try:
            r = requests.get(img_url, timeout=30, headers=REQUEST_HEADERS)
            r.raise_for_status()
            if len(r.content) < 80:
                continue
            im = Image.open(io.BytesIO(r.content))
            im = im.convert("RGBA")
            im.save(logo_file, format="PNG", optimize=True)
            print(f"Saved homepage logo to {logo_file}")
            return True
        except (requests.RequestException, OSError, ValueError, UnidentifiedImageError):
            continue

    print("Warning: could not detect or download a homepage logo (logo.png not written).")
    return False


def _discover_links_from_soup(soup: "Any", current_url: str, base_host: str) -> list[str]:
    """Collect same-site internal links from a parsed BeautifulSoup tree."""
    found: list[str] = []
    for tag in soup.find_all("a", href=True):
        href = tag.get("href", "")
        if not href:
            continue
        absolute = strip_fragment(urljoin(current_url, href))
        if not same_site(absolute, base_host):
            continue
        label = tag.get_text(strip=True)
        if link_contains_junk(absolute, label):
            continue
        found.append(absolute)
    return found


def crawl_from_url(
    raw_url: str,
    *,
    work_dir: Path | None = None,
    campaign_brief: str | None = None,
) -> None:
    """
    Crawl up to MAX_PAGES internal pages; write scraped_content.txt and best-effort logo.png.
    If ``work_dir`` is set, files are written there (isolated API jobs); otherwise BASE_DIR.
    If ``campaign_brief`` is non-empty, it is appended to scraped_content.txt for the creative step.

    Scraping strategy — graceful degradation:
    1. Probe the homepage with a fast, zero-process httpx + BeautifulSoup fetch.
    2. If the page returns substantial ``<p>`` text → it is a static/SSR site; use httpx for
       all pages (Chrome is never launched, saving ~300 MB RAM per Celery worker slot).
    3. If ``<p>`` content is sparse (JS-rendered SPA pattern) *or* the lightweight fetch itself
       fails → fall back to the existing ``build_headless_chrome()`` path for the entire crawl.
    """
    output_file = work_dir / "scraped_content.txt" if work_dir else OUTPUT_FILE
    logo_file = work_dir / "logo.png" if work_dir else LOGO_FILE
    if work_dir is not None:
        work_dir.mkdir(parents=True, exist_ok=True)

    start_url = strip_fragment(normalize_url(raw_url))
    base_host = urlparse(start_url).netloc.lower()
    if not base_host:
        raise ValueError("That URL is not valid.")

    queue: deque[str] = deque()
    visited: set[str] = set()
    pages_fetched = 0
    file_chunks: list[str] = []
    logo_saved = False
    driver: WebDriver | None = None
    uc_profile: str | None = None

    # ── Phase 1: lightweight homepage probe ──────────────────────────────────
    use_chrome = False
    print("Probing homepage with lightweight fetch (httpx + BeautifulSoup)…")
    try:
        lw_title, lw_paras, lw_soup, lw_final_url = _lightweight_fetch_page(start_url)
        if _is_content_sparse(lw_paras):
            total_chars = sum(len(p) for p in lw_paras)
            print(
                f"Sparse <p> content detected ({total_chars} chars across "
                f"{len(lw_paras)} tags) — JS-rendered SPA likely. "
                "Falling back to headless Chrome…"
            )
            use_chrome = True
            queue.append(start_url)
        else:
            print(
                f"Static content confirmed ({len(lw_paras)} paragraphs, "
                f"{sum(len(p) for p in lw_paras)} chars). "
                "Chrome not needed — using httpx for all pages."
            )
            # Consume the already-fetched first page immediately.
            visited.add(start_url)
            visited.add(lw_final_url)
            file_chunks.append(format_page_block(lw_final_url, lw_title, lw_paras))
            pages_fetched += 1
            print(f"Scraped (1/{MAX_PAGES}): {lw_final_url}")
            logo_saved = _extract_logo_from_soup(lw_soup, lw_final_url, logo_file)
            for abs_link in _discover_links_from_soup(lw_soup, lw_final_url, base_host):
                if abs_link not in visited:
                    queue.append(abs_link)
    except ImportError:
        print("httpx/beautifulsoup4 not installed — falling back to headless Chrome.")
        use_chrome = True
        queue.append(start_url)
    except Exception as probe_exc:
        print(f"Lightweight probe failed ({probe_exc}) — falling back to headless Chrome.")
        use_chrome = True
        queue.append(start_url)

    # ── Phase 2: start Chrome only if the probe signalled a SPA ─────────────
    if use_chrome:
        print("Starting headless Chrome (undetected-chromedriver)…")
        driver = build_headless_chrome()
        uc_profile = getattr(driver, "_banner_uc_profile_dir", None)

    # ── Phase 3: crawl remaining pages with the chosen strategy ─────────────
    try:
        while queue and pages_fetched < MAX_PAGES:
            url = queue.popleft()
            if url in visited:
                continue
            visited.add(url)

            if pages_fetched > 0:
                time.sleep(random.uniform(1, 3))

            if use_chrome:
                # ── Chrome path (JS rendering) ────────────────────────────────
                assert driver is not None
                try:
                    try:
                        driver.get(url)
                    except TimeoutException:
                        try:
                            driver.execute_script("window.stop();")
                        except WebDriverException:
                            pass
                except (UnexpectedAlertPresentException, WebDriverException) as nav_err:
                    _safe_dismiss_alerts(driver)
                    print(f"Skip (navigation failed): {url} — {nav_err}")
                    continue

                try:
                    _wait_dom_ready(driver, DOM_READY_TIMEOUT_SECONDS)
                except (TimeoutException, WebDriverException):
                    pass

                try:
                    _auto_dismiss_cookie_banners(driver)
                except Exception:
                    pass

                try:
                    WebDriverWait(driver, RENDER_WAIT_SECONDS).until(
                        EC.presence_of_element_located((By.TAG_NAME, "body"))
                    )
                except (TimeoutException, WebDriverException):
                    pass

                final_url = strip_fragment(driver.current_url)

                try:
                    title_text, paragraph_texts = extract_title_and_paragraphs(driver)
                except WebDriverException as ext_err:
                    print(f"Skip (extract failed): {final_url} — {ext_err}")
                    continue

                if not logo_saved:
                    logo_saved = extract_and_save_homepage_logo(driver, logo_file)

                try:
                    for absolute in discover_internal_links(driver, base_host):
                        if absolute not in visited:
                            queue.append(absolute)
                except WebDriverException as lnk_err:
                    print(f"Warning: link discovery failed on {final_url} — {lnk_err}")

            else:
                # ── Lightweight path (httpx + BeautifulSoup) ─────────────────
                try:
                    title_text, paragraph_texts, lw_soup, final_url = (
                        _lightweight_fetch_page(url)
                    )
                except Exception as fetch_err:
                    print(f"Skip (lightweight fetch failed): {url} — {fetch_err}")
                    continue

                if not logo_saved:
                    logo_saved = _extract_logo_from_soup(lw_soup, final_url, logo_file)

                for abs_link in _discover_links_from_soup(lw_soup, final_url, base_host):
                    if abs_link not in visited:
                        queue.append(abs_link)

            file_chunks.append(format_page_block(final_url, title_text, paragraph_texts))
            pages_fetched += 1
            print(f"Scraped ({pages_fetched}/{MAX_PAGES}): {final_url}")

    finally:
        if driver is not None:
            _browser_pid: int | None = getattr(driver, "browser_pid", None)
            _cd_pid: int | None = getattr(driver, "_banner_chromedriver_pid", None)
            _active_drivers.discard(driver)
            _kill_uc_browser_process_tree(_browser_pid)
            _kill_uc_browser_process_tree(_cd_pid)
            try:
                driver.quit()
            except Exception:
                pass
            if uc_profile:
                shutil.rmtree(uc_profile, ignore_errors=True)

    with open(output_file, "w", encoding="utf-8") as f:
        f.write(f"Crawl summary: {pages_fetched} page(s), starting from {start_url}\n\n")
        f.write("".join(file_chunks))
        if campaign_brief and str(campaign_brief).strip():
            f.write("\n\n")
            f.write(SEPARATOR + "\n")
            f.write(
                "USER CAMPAIGN BRIEF (goals / target audience — provided by the user)\n"
            )
            f.write(SEPARATOR + "\n\n")
            f.write(str(campaign_brief).strip() + "\n")

    print(f"Done. Content saved to {output_file} ({pages_fetched} page(s)).")


def main() -> None:
    raw_url = input("Enter a URL: ")
    if not raw_url.strip():
        print("Error: URL cannot be empty.")
        return

    try:
        crawl_from_url(raw_url)
    except ValueError as e:
        print(f"Error: {e}")
        return

    if os.environ.get("OPENAI_API_KEY"):
        run_agency_banner_pipeline(site_url=raw_url)
    else:
        print(
            "Tip: set OPENAI_API_KEY to generate creative_campaign.json and background.png "
            "after crawl (requires logo.png)."
        )


if __name__ == "__main__":
    main()
