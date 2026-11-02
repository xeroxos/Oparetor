from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory
from flask_cors import CORS
import re
import requests
import httpx
from datetime import datetime
import os
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

STATIC_DIR = os.environ.get(
    "STATIC_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uid-web", "dist", "public"),
)
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
CORS(app)

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


def get_public_info(uid: str) -> dict:
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
        r = requests.get(
            f"https://m.facebook.com/profile.php?id={uid}",
            headers=IPHONE_HEADERS,
            timeout=12,
            verify=False,
            allow_redirects=True,
        )
        if r.status_code != 200:
            return {}

        soup = BeautifulSoup(r.text, 'html.parser')
        result: dict = {}

        # --- Name ---
        t = soup.find('title')
        if t:
            candidate = re.sub(r'\s*\|\s*Facebook\s*$', '', t.get_text(strip=True)).strip()
            if candidate.lower() not in BAD_TITLES and len(candidate) > 1:
                result['name'] = candidate
        if not result.get('name'):
            og_title = soup.find('meta', property='og:title')
            if og_title and og_title.get('content', '').strip().lower() not in BAD_TITLES:
                result['name'] = og_title['content'].strip()

        # --- Profile pic CDN URL (og:image) ---
        og_image = soup.find('meta', property='og:image')
        if og_image and og_image.get('content'):
            cdn = og_image['content']
            if 'fbcdn.net' in cdn or 'scontent' in cdn:
                result['profile_pic'] = cdn
                _cache_cdn(uid, cdn)  # pre-warm proxy cache

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

        return result
    except Exception:
        return {}


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
            r = requests.get(url_template, headers=ua_headers, timeout=10, verify=False, allow_redirects=True)
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, 'html.parser')
                og_image = soup.find('meta', property='og:image')
                if og_image and og_image.get('content'):
                    cdn = og_image['content']
                    if 'fbcdn.net' in cdn or 'scontent' in cdn:
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
        with httpx.Client(http2=False, verify=False, timeout=15, follow_redirects=True) as client:
            r = client.get(
                MBASIC_PROFILE_URL.format(uid=uid),
                headers=BASE_HEADERS,
                cookies=cookies,
            )
            if r.status_code != 200:
                return {}

            soup = BeautifulSoup(r.text, 'html.parser')

            # Check session is valid (not login page)
            title_tag = soup.find('title')
            if title_tag:
                title_text = title_tag.get_text(strip=True).lower()
                if 'log in' in title_text or title_text in ('error', 'facebook'):
                    return {}

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
                if 'fbcdn.net' in url:
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
        return {}


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
            verify=False,
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
        fut_pub = inner.submit(get_public_info, uid)
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
        result['profile_pic'] = f"/fb-api/proxy/pic/{uid}"

    # Follower count
    if mbasic.get('follower_count') is not None:
        result['follower_count'] = mbasic['follower_count']

    # Mark success
    if result['name'] or cdn_pic:
        result['status'] = 'success'

    # Instagram check (only if we have a username)
    if result.get('username'):
        result['has_instagram'] = check_instagram(result['username'])

    return result


@bp.route('/proxy/pic/<uid>', methods=['GET'])
def proxy_pic(uid: str):
    """
    Proxy the real Facebook profile picture for a given UID.
    Serves from in-memory CDN cache (pre-warmed during batch fetch) — instant.
    Falls back to fresh og:image fetch if cache miss.
    """
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
            verify=False,
            stream=True,
        )
        if img_resp.status_code != 200:
            # CDN URL may have expired — clear cache and return 404
            _cdn_cache.pop(uid, None)
            return jsonify({'error': 'CDN fetch failed'}), 502

        content_type = img_resp.headers.get('Content-Type', 'image/jpeg')

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

    # Read cookie fresh at request time — no restart needed after env var update
    cookie_str = data.get('cookie', '') or os.environ.get("FB_DEFAULT_COOKIE", "")
    global_cookies = parse_cookies(cookie_str)

    def process_one(item):
        uid = str(item.get('uid', '')).strip()
        password = item.get('password')
        if not uid:
            return None

        extra_cookies = global_cookies or None
        result = fetch_uid_info(uid, extra_cookies)
        return {'uid': uid, 'password': password, 'result': result}

    results = []
    max_workers = min(20, max(1, len(uid_list)))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(process_one, item) for item in uid_list]
        for fut in as_completed(futures):
            try:
                r = fut.result(timeout=25)
                if r is not None:
                    results.append(r)
            except Exception:
                pass

    return jsonify({
        'success': True,
        'results': results,
        'total': len(results),
        'timestamp': datetime.now().isoformat()
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
    if path.startswith('api/'):
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
