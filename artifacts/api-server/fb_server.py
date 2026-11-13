from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory
import re
import requests
import httpx
from datetime import datetime
import os
from urllib.parse import urlsplit
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

STATIC_DIR = os.environ.get(
    "STATIC_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uid-web", "dist", "public"),
)
app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 128 * 1024  # reject oversized API payloads

from flask import Blueprint

bp = Blueprint('fb', __name__)

GRAPH_PICTURE_URL = "https://graph.facebook.com/{uid}/picture?type=large&redirect=false"
MBASIC_PROFILE_URL = "https://mbasic.facebook.com/profile.php?id={uid}"
WWW_PROFILE_URL = "https://www.facebook.com/profile.php?id={uid}"

# Samsung browser UA — mbasic returns og:image with real CDN photo
SAMSUNG_UA = 'Mozilla/5.0 (Linux; Android 9; SAMSUNG SM-G960U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/10.1 Chrome/71.0.3578.99 Mobile Safari/537.36'

# Facebook crawler UA — used for image proxying
FBOT_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

# iPhone Safari UA — m.facebook.com returns real name in <title> without cookies
IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

BASE_HEADERS = {
    'User-Agent': SAMSUNG_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

FBOT_HEADERS = {
    'User-Agent': FBOT_UA,
    'Accept': 'text/html,*/*;q=0.8',
}

IPHONE_HEADERS = {
    'User-Agent': IPHONE_UA,
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}


def parse_cookies(cookie_string: str) -> dict:
    cookies = {}
    if cookie_string:
        for pair in cookie_string.split(';'):
            pair = pair.strip()
            if '=' in pair:
                key, value = pair.split('=', 1)
                cookies[key.strip()] = value.strip()
    return cookies


def get_default_cookie() -> dict:
    """Read cookie from env at request time so updates take effect without restart."""
    raw = os.environ.get("FB_DEFAULT_COOKIE", "")
    return parse_cookies(raw)


def _valid_fb_image(url: str) -> bool:
    """Only permit HTTPS images hosted by Facebook's known CDN."""
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or '').lower()
        return (parsed.scheme == 'https'
                and (host == 'fbcdn.net' or host.endswith('.fbcdn.net'))
                and len(url) < 4096)
    except ValueError:
        return False


def get_public_info(uid: str, cookies: dict | None = None) -> dict:
    """
    Single m.facebook.com request → name + username + profile pic CDN URL.
    iPhone UA returns <title>=name, og:image=real CDN photo, og:url=username.
    Returns dict with 'name', 'username', 'profile_pic' (CDN URL) keys.
    """
    BAD_TITLES = {
        'facebook', 'error', 'log in to facebook', 'log in', 'log into facebook',
        'login', 'sign up', 'create an account', ''
    }
    try:
        # Treat login walls and rate limits as stop conditions, not invalid UIDs.
        r = None
        upstream_error = 'unavailable'
        for host in ('m.facebook.com', 'www.facebook.com'):
            try:
                candidate = requests.get(
                    f"https://{host}/profile.php?id={uid}",
                    headers=IPHONE_HEADERS,
                    cookies=cookies or None,
                    timeout=10,
                    allow_redirects=True,
                    verify=True,
                )
                if candidate.status_code == 429:
                    return {'error': 'rate_limited'}
                if candidate.status_code in (401, 403):
                    return {'error': 'login_required'}
                if candidate.status_code in (502, 503, 504):
                    upstream_error = 'network_error'
                    continue
                if re.search(r'login|checkpoint|recover|save-device', str(candidate.url), re.I):
                    return {'error': 'login_required'}
                if candidate.status_code == 200:
                    r = candidate
                    break
            except requests.RequestException:
                upstream_error = 'network_error'
        if r is None:
            return {'error': upstream_error}
        soup = BeautifulSoup(r.text, 'html.parser')
        result: dict = {}

        # --- Name ---
        t = soup.find('title')
        if t and re.search(r'log in|log into|sign up|create an account|checkpoint', t.get_text(strip=True), re.I):
            return {'error': 'login_required'}
        if t:
            candidate = re.sub(r'\s*\|\s*Facebook\s*$', '', t.get_text(strip=True)).strip()
            if candidate.lower() not in BAD_TITLES and len(candidate) > 1 and not re.search(r'log in|sign up|create an account|facebook helps', candidate, re.I):
                result['name'] = candidate
        if not result.get('name'):
            og_title = soup.find('meta', property='og:title')
            if og_title and og_title.get('content', '').strip().lower() not in BAD_TITLES and not re.search(r'log in|sign up|create an account', og_title.get('content', ''), re.I):
                result['name'] = og_title['content'].strip()

        # --- Profile pic CDN URL (og:image) ---
        og_image = soup.find('meta', property='og:image')
        if og_image and og_image.get('content'):
            cdn = og_image['content']
            if _valid_fb_image(cdn):
                result['profile_pic'] = cdn
                _cache_cdn(uid, cdn)  # pre-warm proxy cache

        # --- Public follower count (only when exposed in page metadata) ---
        og_desc = soup.find('meta', property='og:description') or soup.find('meta', attrs={'name': 'description'})
        if og_desc and og_desc.get('content'):
            match = re.search(r'([\d,]+)\s+followers', og_desc['content'], re.I)
            if match:
                try:
                    result['follower_count'] = int(match.group(1).replace(',', ''))
                except ValueError:
                    pass

        # --- Username ---
        BAD_SLUGS = {'profile.php', 'home.php', 'login', 'sharer', ''}
        for src_attr in [
            soup.find('meta', property='og:url'),
            soup.find('link', rel='canonical'),
        ]:
            if src_attr:
                href = src_attr.get('content') or src_attr.get('href', '')
                m = re.search(r'facebook\.com/([^/?#]+)', href)
                if m and m.group(1) not in BAD_SLUGS:
                    result['username'] = m.group(1)
                    break
        if not result.get('username') and r.url:
            m = re.search(r'facebook\.com/([^/?#]+)', r.url)
            if m and m.group(1) not in BAD_SLUGS:
                result['username'] = m.group(1)

        if not (result.get('name') or result.get('profile_pic')):
            result['error'] = 'unavailable'
        return result
    except Exception:
        return {'error': 'network_error'}


# Keep old name as alias for any callers
def get_name_public(uid: str) -> dict:
    info = get_public_info(uid)
    return {'name': info.get('name'), 'username': info.get('username')}


# ---------------------------------------------------------------------------
# In-memory CDN URL cache: uid -> (cdn_url, timestamp)
# Pre-warmed during batch fetch so proxy_pic endpoint is instant.
# ---------------------------------------------------------------------------
import time as _time
_cdn_cache: dict = {}
_CDN_TTL = 7200  # 2 hours


def _cache_cdn(uid: str, url: str) -> None:
    _cdn_cache[uid] = (url, _time.time())


def _get_cached_cdn(uid: str) -> str | None:
    entry = _cdn_cache.get(uid)
    if entry:
        url, ts = entry
        if _time.time() - ts < _CDN_TTL:
            return url
    return None


def get_real_profile_pic_url(uid: str) -> str | None:
    """
    Fetch real CDN profile picture URL. Checks memory cache first.
    Uses iPhone UA on m.facebook.com (same page as name fetch) to get og:image.
    """
    cached = _get_cached_cdn(uid)
    if cached:
        return cached

    for url_template, ua_headers in [
        (f"https://m.facebook.com/profile.php?id={uid}", IPHONE_HEADERS),
        (f"https://www.facebook.com/profile.php?id={uid}", BASE_HEADERS),
    ]:
        try:
            r = requests.get(url_template, headers=ua_headers, timeout=10, verify=True, allow_redirects=True)
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, 'html.parser')
                og_image = soup.find('meta', property='og:image')
                if og_image and og_image.get('content'):
                    cdn = og_image['content']
                    if _valid_fb_image(cdn):
                        _cache_cdn(uid, cdn)
                        return cdn
        except Exception:
            continue
    return None


def get_followers_with_cookies(uid: str, cookies: dict) -> dict:
    """
    Fetch follower count (and fallback name/pic) from mbasic.facebook.com with Samsung UA + cookies.
    Returns dict with 'follower_count', optionally 'name', 'profile_pic'.
    """
    if not cookies:
        return {}
    try:
        with httpx.Client(http2=False, verify=True, timeout=15, follow_redirects=True) as client:
            r = client.get(
                MBASIC_PROFILE_URL.format(uid=uid),
                headers=BASE_HEADERS,
                cookies=cookies,
            )
            if r.status_code == 429:
                return {'error': 'rate_limited'}
            if r.status_code in (401, 403):
                return {'error': 'login_required'}
            if r.status_code != 200:
                return {'error': 'network_error' if r.status_code >= 500 else 'unavailable'}
            if re.search(r'login|checkpoint|recover|save-device', str(r.url), re.I):
                return {'error': 'login_required'}

            soup = BeautifulSoup(r.text, 'html.parser')

            # Check session is valid (not login page)
            title_tag = soup.find('title')
            if title_tag:
                title_text = title_tag.get_text(strip=True).lower()
                if 'log in' in title_text or title_text in ('error', 'facebook'):
                    return {'error': 'login_required'}

            result = {}

            # Name from title
            if title_tag:
                candidate = title_tag.get_text(strip=True)
                BAD = {'error', 'facebook', 'log in', 'log in to facebook', 'log into facebook', ''}
                if candidate.lower() not in BAD:
                    result['name'] = candidate

            # Profile pic from og:image
            og_image = soup.find('meta', property='og:image')
            if og_image and og_image.get('content'):
                url = og_image['content']
                if _valid_fb_image(url):
                    result['profile_pic'] = url

            # Follower count from og:description
            og_desc = soup.find('meta', property='og:description')
            if og_desc and og_desc.get('content'):
                m = re.search(r'([\d,]+)\s*(?:likes|followers)', og_desc['content'], re.IGNORECASE)
                if m:
                    try:
                        result['follower_count'] = int(m.group(1).replace(',', ''))
                    except Exception:
                        pass

            return result
    except Exception:
        return {'error': 'network_error'}


def check_instagram(username: str) -> bool:
    """Check if an Instagram account exists for the given username."""
    if not username or len(username) < 2:
        return False
    try:
        r = requests.head(
            f"https://www.instagram.com/{username}/",
            headers={
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,*/*;q=0.8',
            },
            timeout=6,
            allow_redirects=True,
        )
        return r.status_code == 200
    except Exception:
        return False


def fetch_uid_info(uid: str, extra_cookies: dict | None) -> dict:
    """
    Fetch all public info for a UID in parallel:
      A) m.facebook.com (iPhone UA) → name + username + profile pic CDN URL  [1 request]
      B) mbasic.facebook.com (Samsung UA + cookies) → follower count           [1 request]
      C) Instagram head check → has_instagram                                   [1 request]
    A+B run concurrently via ThreadPoolExecutor inside this function.
    """
    result = {
        'status': 'error',
        'name': None,
        'username': None,
        'profile_pic': None,
        'follower_count': None,
        'has_instagram': False,
    }

    cookies = extra_cookies or {}

    # Run public info + followers concurrently
    with ThreadPoolExecutor(max_workers=2) as inner:
        fut_pub = inner.submit(get_public_info, uid, cookies or None)
        fut_mbasic = inner.submit(get_followers_with_cookies, uid, cookies) if cookies else None

        pub = fut_pub.result(timeout=20)
        mbasic = fut_mbasic.result(timeout=20) if fut_mbasic else {}

    # --- Merge results ---
    result['name'] = pub.get('name') or mbasic.get('name')
    result['username'] = pub.get('username')

    # Profile pic: use direct CDN URL — browser loads it without any proxy
    cdn_pic = pub.get('profile_pic') or mbasic.get('profile_pic')
    if cdn_pic:
        _cache_cdn(uid, cdn_pic)
        result['profile_pic'] = cdn_pic
    else:
        # Fallback: proxy URL (browser → Express → Flask → CDN)
        result['profile_pic'] = None  # never return a broken HTML SPA path as an image

    # Follower count
    if mbasic.get('follower_count') is not None:
        result['follower_count'] = mbasic['follower_count']
    elif pub.get('follower_count') is not None:
        result['follower_count'] = pub['follower_count']

    # A login wall/rate limit is a batch stop, not proof that each UID is bad.
    if result['name'] or cdn_pic:
        result['status'] = 'success'
    else:
        reasons = {pub.get('error'), mbasic.get('error')}
        for code in ('rate_limited', 'login_required', 'network_error', 'unavailable'):
            if code in reasons:
                result['error'] = code
                break
        else:
            result['error'] = 'unavailable'

    # Instagram check (only if we have a username)
    if os.environ.get('ENABLE_INSTAGRAM_CHECK', 'false').lower() == 'true' and result.get('username'):
        result['has_instagram'] = check_instagram(result['username'])

    return result


@bp.route('/proxy/pic/<uid>', methods=['GET'])
def proxy_pic(uid: str):
    """
    Proxy the real Facebook profile picture for a given UID.
    Serves from in-memory CDN cache (pre-warmed during batch fetch) — instant.
    Falls back to fresh og:image fetch if cache miss.
    """
    if not re.fullmatch(r'[0-9]{5,25}', uid):
        return jsonify({'error': 'Invalid UID'}), 400
    # 1. Check in-memory cache first (pre-warmed during /uid/fetch)
    cdn_url = _get_cached_cdn(uid)

    # 2. Cache miss → fetch fresh CDN URL (same iPhone UA that works for name)
    if not cdn_url:
        cdn_url = get_real_profile_pic_url(uid)  # also populates cache

    if not cdn_url:
        return jsonify({'error': 'No picture found'}), 404

    # Stream image back from CDN — browser sees image/jpeg, not the CDN URL
    try:
        img_resp = requests.get(
            cdn_url,
            headers={'User-Agent': FBOT_UA, 'Referer': 'https://www.facebook.com/'},
            timeout=12,
            stream=True,
        )
        if img_resp.status_code != 200:
            # CDN URL may have expired — clear cache and return 404
            _cdn_cache.pop(uid, None)
            return jsonify({'error': 'CDN fetch failed'}), 502

        content_type = img_resp.headers.get('Content-Type', '')
        if not content_type.lower().startswith('image/'):
            return jsonify({'error': 'CDN response is not an image'}), 502

        def generate():
            for chunk in img_resp.iter_content(chunk_size=8192):
                yield chunk

        return Response(
            stream_with_context(generate()),
            content_type=content_type,
            headers={
                'Cache-Control': 'public, max-age=7200',
                'Access-Control-Allow-Origin': '*',
            }
        )
    except Exception:
        return jsonify({'error': 'Proxy error'}), 502


@bp.route('/', methods=['GET'])
def home():
    return jsonify({
        "name": "Facebook Info Extractor",
        "version": "4.0",
        "endpoints": {
            "POST /uid/fetch": "Fetch profile info for a list of UIDs",
            "GET /proxy/pic/<uid>": "Proxy real profile picture for a UID",
        }
    })


@bp.route('/health', methods=['GET'])
def fb_health():
    return jsonify({"status": "ok"})


@bp.route('/uid/fetch', methods=['POST'])
def fetch_uids():
    data = request.get_json()
    if not data or 'uids' not in data:
        return jsonify({'success': False, 'error': 'Missing uids list'}), 400

    uid_list = data['uids']
    if not isinstance(uid_list, list):
        return jsonify({'success': False, 'error': 'uids must be a list'}), 400
    # Older already-open UI builds send 30 UIDs per request. Preserve compatibility
    # while keeping backend outbound work bounded to ten concurrent workers.
    if not 1 <= len(uid_list) <= 30:
        return jsonify({'success': False, 'error': 'Provide between 1 and 30 UIDs per request'}), 400
    if any(not isinstance(row, dict) or not re.fullmatch(r'[0-9]{5,25}', str(row.get('uid', ''))) for row in uid_list):
        return jsonify({'success': False, 'error': 'Each UID must contain 5-25 digits'}), 400

    # Restore legacy optional browser-session lookup, using the environment's
    # configured session only when the browser has no user-supplied session.
    # Credentials are used in-memory for this request, never logged or returned.
    supplied_cookie = data.get('cookie', '')
    if not isinstance(supplied_cookie, str) or len(supplied_cookie) > 8192:
        return jsonify({'success': False, 'error': 'Invalid session cookie'}), 400
    cookie_str = supplied_cookie.strip() or os.environ.get('FB_DEFAULT_COOKIE', '')
    global_cookies = parse_cookies(cookie_str)

    def process_one(item):
        uid = str(item.get('uid', '')).strip()
        if not uid:
            return None

        extra_cookies = global_cookies or None
        result = fetch_uid_info(uid, extra_cookies)
        return {'uid': uid, 'result': result}

    results = []
    # Limit simultaneous upstream requests when processing repeated large imports.
    # A failed worker must never silently drop a UID from the response.
    max_workers = min(3, len(uid_list))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(process_one, item): str(item['uid'])
            for item in uid_list
        }
        for fut in as_completed(futures):
            try:
                r = fut.result()
                if r is not None:
                    results.append(r)
            except Exception:
                results.append({
                    'uid': futures[fut],
                    'result': {'status': 'error', 'error': 'network_error'}
                })

    diagnostics = {
        'success': sum(1 for item in results if item['result'].get('status') == 'success'),
        'limited': sum(1 for item in results if item['result'].get('error') == 'rate_limited'),
        'login_required': sum(1 for item in results if item['result'].get('error') == 'login_required'),
        'unavailable': sum(1 for item in results if item['result'].get('error') == 'unavailable'),
        'network_error': sum(1 for item in results if item['result'].get('error') == 'network_error'),
    }
    # Aggregate outcome counts only. Never log UIDs, passwords, or sessions.
    app.logger.info(
        'uid_fetch_batch total=%d success=%d login=%d limited=%d network=%d unavailable=%d',
        len(results), diagnostics['success'], diagnostics['login_required'],
        diagnostics['limited'], diagnostics['network_error'], diagnostics['unavailable'],
    )
    return jsonify({
        'success': True,
        'results': results,
        'total': len(results),
        'timestamp': datetime.now().isoformat(),
        'diagnostics': diagnostics,
    })


@bp.route('/uid/check', methods=['POST'])
def check_uid():
    data = request.get_json()
    uid = data.get('uid', '') if data else ''
    return jsonify({
        'success': True,
        'uid': uid,
        'status': 'unknown',
        'message': 'Account check not yet implemented',
        'timestamp': datetime.now().isoformat()
    })


# Legacy endpoints
@bp.route('/profile', methods=['GET', 'POST'])
def get_profile():
    if request.method == 'POST':
        data = request.get_json()
        url = data.get('url') if data else None
    else:
        url = request.args.get('url')

    if not url:
        return jsonify({"status": "error", "message": "Please provide a Facebook profile URL"}), 400

    m = re.search(r'(?:profile\.php\?id=|facebook\.com/)([^/?&]+)', url)
    uid = m.group(1) if m else ''
    if not re.fullmatch(r'[0-9]{5,25}', uid):
        return jsonify({"status": "error", "message": "Invalid numeric UID"}), 400
    result = fetch_uid_info(uid, None)
    return jsonify({"success": True, "data": result, "timestamp": datetime.now().isoformat()})


@bp.route('/apps', methods=['GET', 'POST'])
def get_apps():
    return jsonify({"success": False, "error": "Not implemented in this version"}), 501


app.register_blueprint(bp, url_prefix='/api/fb')


@app.route('/api/admin/track', methods=['POST'])
def track_event():
    return jsonify({'success': True}), 202


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200


@app.route('/', methods=['GET'])
def root():
    index_path = os.path.join(STATIC_DIR, 'index.html')
    if os.path.isfile(index_path):
        return send_from_directory(STATIC_DIR, 'index.html')
    return jsonify({"name": "UID Operator", "version": "4.0", "status": "ok"})


@app.route('/<path:path>', methods=['GET'])
def serve_frontend(path):
    if path.startswith(('api/', 'fb-api/')):
        return jsonify({"success": False, "error": "Endpoint not found"}), 404
    requested = os.path.join(STATIC_DIR, path)
    if os.path.isfile(requested):
        return send_from_directory(STATIC_DIR, path)
    index_path = os.path.join(STATIC_DIR, 'index.html')
    if os.path.isfile(index_path):
        return send_from_directory(STATIC_DIR, 'index.html')
    return jsonify({"success": False, "error": "Frontend not built"}), 404



@app.errorhandler(404)
def not_found(error):
    return jsonify({"success": False, "error": "Endpoint not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({"success": False, "error": "Internal server error"}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5002))
    app.run(host='0.0.0.0', port=port, debug=False)
