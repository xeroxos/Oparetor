from flask import Flask, request, jsonify
import re
import json
import requests
from datetime import datetime
from urllib.parse import urlparse, unquote
import http.client
import ssl
from bs4 import BeautifulSoup

app = Flask(__name__)

ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

class FacebookInfoExtractor:
    def __init__(self):
        self.headers = {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-language': 'en-US,en;q=0.9',
            'dpr': '1.5',
            'priority': 'u=0, i',
            'sec-ch-prefers-color-scheme': 'dark',
            'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Microsoft Edge";v="146"',
            'sec-ch-ua-full-version-list': '"Chromium";v="146.0.7680.76", "Not-A.Brand";v="24.0.0.0", "Microsoft Edge";v="146.0.3856.59"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-model': '""',
            'sec-ch-ua-platform': '"Windows"',
            'sec-ch-ua-platform-version': '"19.0.0"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'sec-fetch-user': '?1',
            'upgrade-insecure-requests': '1',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0'
        }

    def resolve_facebook_url(self,url):
        try:
        	r = requests.get(url, allow_redirects=True, timeout=10)
        	return r.url
        except:
        	return url

    def fetch_url(self, url):
        try:
            parsed = urlparse(url)
            host = parsed.netloc
            path = parsed.path or '/'
            if parsed.query:
                path += '?' + parsed.query
            
            conn = http.client.HTTPSConnection(host, context=ssl_context, timeout=15)
            conn.request('GET', path, headers=self.headers)
            response = conn.getresponse()
            
            if response.status == 200:
                data = response.read()
                conn.close()
                return data.decode('utf-8', errors='ignore')
            conn.close()
            return None
        except Exception:
            return None
    
    def extract_profile_info(self, url):
        try:
            url = self.resolve_facebook_url(url)
            html_content = self.fetch_url(url)
            if not html_content:
                return {
                    "status": "error",
                    "message": "Could not fetch profile page"
                }
            
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # ========================
            # NAME EXTRACTION
            # ========================
            name = "Not found"
            name_tag = soup.find('meta', property='og:title')
            if name_tag and name_tag.get('content'):
                name = name_tag['content']
            
            # ========================
            # USERNAME EXTRACTION
            # ========================
            username = "Not found"
            userid = "Not found"
            id_match = re.search(r'profile\.php\?id=(\d+)', url)
            if id_match:
                userid = id_match.group(1)
                username = userid
            else:
                url_tag = soup.find('meta', property='og:url')
                if url_tag and url_tag.get('content'):
                	url_match = re.search(r'facebook\.com/([^/?]+)', url_tag['content'])
                	if url_match:
                	    username = url_match.group(1)
            # ========================
            # USER ID EXTRACTION
            # ========================
            userid = "Not found"
            android_tag = soup.find('meta', property='al:android:url')
            if android_tag and android_tag.get('content'):
                id_match = re.search(r'profile/(\d+)', android_tag['content'])
                if id_match:
                    userid = id_match.group(1)
            
            # ========================
            # PROFILE PICTURE EXTRACTION
            # ========================
            profile_pic = "Not found"
            pic_tag = soup.find('meta', property='og:image')
            if pic_tag and pic_tag.get('content'):
                profile_pic = pic_tag['content']
            
            # ========================
            # COVER PHOTO EXTRACTION
            # ========================
            cover_photo = "Not found"
            cover_match = re.search(r'"cover_photo"[^}]*"uri":"([^"]+)"', html_content)
            if cover_match:
                cover_photo = cover_match.group(1).replace('\\', '')
            
            # ========================
            # GENDER EXTRACTION
            # ========================
            gender = "Not found"
            gender_match = re.search(r'"gender":"([^"]+)"', html_content, re.IGNORECASE)
            if gender_match:
                gender_text = gender_match.group(1)
                gender = "Male" if gender_text.lower() == "male" else "Female" if gender_text.lower() == "female" else gender_text
            
            # ========================
            # FOLLOWER/LIKES COUNT EXTRACTION
            # ========================
            follower_count = "Not found"
            
            # Method 1: og:description meta tag theke
            meta_desc = soup.find('meta', property='og:description')
            if meta_desc and meta_desc.get('content'):
                desc_content = meta_desc['content']
                # Pattern: "2,703 likes" or "2,703 followers"
                match = re.search(r'([\d,]+)\s+(?:likes|followers)', desc_content, re.IGNORECASE)
                if match:
                    follower_count = match.group(1).replace(',', '')
            
            # Method 2: Direct HTML e search (if meta tag fails)
            if follower_count == "Not found":
                match_likes = re.search(r'([\d,]+)\s+likes', html_content, re.IGNORECASE)
                match_followers = re.search(r'([\d,]+)\s+followers', html_content, re.IGNORECASE)
                
                if match_likes:
                    follower_count = match_likes.group(1).replace(',', '')
                elif match_followers:
                    follower_count = match_followers.group(1).replace(',', '')
            
            # Method 3: Specific div/span search (fallback)
            if follower_count == "Not found":
                # Generic pattern: find any span/div that contains number + likes/followers
                count_elem = soup.find(['span', 'div'], string=re.compile(r'[\d,]+ (?:likes|followers)', re.IGNORECASE))
                if count_elem:
                    count_match = re.search(r'([\d,]+)', count_elem.text)
                    if count_match:
                        follower_count = count_match.group(1).replace(',', '')
            
            return {
                "name": name,
                "username": username,
                "user_id": userid,
                "gender": gender,
                "profile_pic": profile_pic,
                "cover_photo": cover_photo,
                "follower_count": follower_count,  # New field added
                "status": "success"
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Extraction failed: {str(e)}"
            }
    
    def parse_cookies(self, cookie_string):
        cookies = {}
        if cookie_string:
            pairs = cookie_string.split(';')
            for pair in pairs:
                pair = pair.strip()
                if '=' in pair:
                    key, value = pair.split('=', 1)
                    cookies[key.strip()] = value.strip()
        return cookies
    
    def fetch_apps_page(self, cookies):
        try:
            cookie_header = '; '.join([f'{k}={v}' for k, v in cookies.items()])
            
            conn = http.client.HTTPSConnection('www.facebook.com', context=ssl_context, timeout=20)
            
            headers = self.headers.copy()
            headers['cookie'] = cookie_header
            
            conn.request('GET', '/settings/?tab=applications', headers=headers)
            response = conn.getresponse()
            
            if response.status == 200:
                data = response.read()
                conn.close()
                return data.decode('utf-8', errors='ignore')
            conn.close()
            return None
        except Exception:
            return None
    
    def format_timestamp(self, timestamp_str):
        if not timestamp_str or timestamp_str == '0':
            return "N/A"
        try:
            timestamp = int(timestamp_str)
            return datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d %H:%M:%S')
        except:
            return "Invalid date"
    
    def extract_apps(self, html_content):
        apps = {
            'active': [],
            'expired': [],
            'removed': []
        }
        
        json_data = html_content
        json_pattern = r'{"__bbox":{"complete":true,"result":({.*})},"sequence_number":0}}'
        match = re.search(json_pattern, html_content, re.DOTALL)
        if match:
            json_str = match.group(1)
            json_str = re.sub(r'\\"', '"', json_str)
            json_str = re.sub(r'\\/', '/', json_str)
            json_data = json_str
        
        active_pattern = r'"activeApps":\{"edges":\[(.*?)\]\}'
        active_section = re.search(active_pattern, json_data, re.DOTALL)
        if active_section:
            app_pattern = r'"node":\{.*?"app_name":"([^"]+)".*?"install_timestamp":"(\d+)".*?"app_status":"Active"'
            apps_content = active_section.group(1)
            app_matches = re.findall(app_pattern, apps_content, re.DOTALL)
            
            for name, timestamp in app_matches:
                if name and timestamp:
                    apps['active'].append({
                        'name': name,
                        'connected_date': self.format_timestamp(timestamp),
                        'status': 'active'
                    })
        
        expired_pattern = r'"expiredApps":\{"edges":\[(.*?)\]\}'
        expired_section = re.search(expired_pattern, json_data, re.DOTALL)
        if expired_section:
            app_pattern = r'"node":\{.*?"app_name":"([^"]+)".*?"install_timestamp":"(\d+)".*?"uninstall_timestamp":"(\d+)"'
            apps_content = expired_section.group(1)
            app_matches = re.findall(app_pattern, apps_content, re.DOTALL)
            
            for name, install_ts, uninstall_ts in app_matches:
                if name:
                    apps['expired'].append({
                        'name': name,
                        'connected_date': self.format_timestamp(install_ts),
                        'expired_date': self.format_timestamp(uninstall_ts),
                        'status': 'expired'
                    })
        
        removed_pattern = r'"removedApps":\{"edges":\[(.*?)\]\}'
        removed_section = re.search(removed_pattern, json_data, re.DOTALL)
        if removed_section:
            app_pattern = r'"node":\{.*?"app_name":"([^"]+)".*?"disconnected_facebook_login_timestamp":"(\d+)"'
            apps_content = removed_section.group(1)
            app_matches = re.findall(app_pattern, apps_content, re.DOTALL)
            
            for name, timestamp in app_matches:
                if name:
                    apps['removed'].append({
                        'name': name,
                        'disconnected_date': self.format_timestamp(timestamp),
                        'status': 'removed'
                    })
        
        for category in apps:
            seen = set()
            unique_apps = []
            for app in apps[category]:
                if app['name'] not in seen:
                    seen.add(app['name'])
                    unique_apps.append(app)
            apps[category] = unique_apps
        
        return apps

extractor = FacebookInfoExtractor()

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "name": "Facebook Information Extractor",
        "version": "2.0",
        "description": "Extract Facebook profile and app information",
        "endpoints": {
            "GET /": "API information",
            "GET /profile": "Extract profile info using ?url= parameter",
            "GET /apps": "Extract app info using ?cookies= parameter",
            "POST /profile": "Extract profile info with JSON body containing 'url' field",
            "POST /apps": "Extract app info with JSON body containing 'cookies' field"
        },
        "examples": {
            "profile_get": "/profile?url=https://www.facebook.com/zuck",
            "profile_post": "POST /profile with {\"url\": \"https://www.facebook.com/zuck\"}",
            "apps_get": "/apps?cookies=c_user=12345;xs=abc123",
            "apps_post": "POST /apps with {\"cookies\": \"c_user=12345;xs=abc123\"}"
        }
    })

@app.route('/profile', methods=['GET', 'POST'])
def get_profile():
    if request.method == 'POST':
        data = request.get_json()
        url = data.get('url') if data else None
    else:
        url = request.args.get('url')
    
    if not url:
        return jsonify({
            "status": "error",
            "message": "Please provide a Facebook profile URL"
        }), 400
    
    if 'facebook.com' not in url:
        return jsonify({
            "status": "error",
            "message": "Please provide a valid Facebook URL"
        }), 400
    
    result = extractor.extract_profile_info(url)
    
    if result.get('status') == 'error':
        return jsonify(result), 400
    
    return jsonify({
        "success": True,
        "data": result,
        "timestamp": datetime.now().isoformat()
    })

@app.route('/apps', methods=['GET', 'POST'])
def get_apps():
    try:
        if request.method == 'POST':
            data = request.get_json()
            cookie_string = data.get('cookies') if data else None
        else:
            cookie_string = request.args.get('cookies')
        
        if not cookie_string:
            return jsonify({
                "success": False,
                "error": "Missing cookies",
                "message": "Please provide Facebook cookies"
            }), 400
        
        cookies = extractor.parse_cookies(cookie_string)
        
        required = ['c_user', 'xs']
        missing = [c for c in required if c not in cookies]
        
        if missing:
            return jsonify({
                "success": False,
                "error": "Missing required cookies",
                "missing": missing
            }), 400
        
        html_content = extractor.fetch_apps_page(cookies)
        
        if not html_content:
            return jsonify({
                "success": False,
                "error": "Could not fetch apps page",
                "message": "Cookies may be invalid or expired"
            }), 400
        
        apps_data = extractor.extract_apps(html_content)
        
        summary = {
            "total_active": len(apps_data['active']),
            "total_expired": len(apps_data['expired']),
            "total_removed": len(apps_data['removed']),
            "total_apps": len(apps_data['active']) + len(apps_data['expired']) + len(apps_data['removed'])
        }
        
        return jsonify({
            "success": True,
            "data": apps_data,
            "summary": summary,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": "Internal server error",
            "message": str(e)
        }), 500

@app.route('/batch/profile', methods=['POST'])
def batch_profile():
    data = request.get_json()
    
    if not data or 'urls' not in data:
        return jsonify({
            "success": False,
            "error": "Please provide a list of URLs"
        }), 400
    
    urls = data['urls']
    
    if not isinstance(urls, list):
        return jsonify({
            "success": False,
            "error": "URLs must be a list"
        }), 400
    
    results = []
    for url in urls:
        if 'facebook.com' in url:
            result = extractor.extract_profile_info(url)
        else:
            result = {
                "status": "error",
                "message": "Invalid Facebook URL"
            }
        results.append({
            "url": url,
            "result": result
        })
    
    return jsonify({
        "success": True,
        "results": results,
        "total": len(results),
        "timestamp": datetime.now().isoformat()
    })

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        "success": False,
        "error": "Endpoint not found"
    }), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        "success": False,
        "error": "Internal server error"
    }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=True)