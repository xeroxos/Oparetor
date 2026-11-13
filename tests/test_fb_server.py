"""Network-free regression checks for the production UID Operator Flask API."""
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from fb_server import app, _valid_fb_image, get_public_info


class UIDOperatorAPITests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_health(self):
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["status"], "ok")

    def test_invalid_or_oversized_uid_batches(self):
        bad_payloads = [
            {}, {"uids": []}, {"uids": "12345678901"},
            {"uids": [{"uid": "not-an-id"}]},
            {"uids": [{"uid": "12345678901"}] * 31},
            {"uids": [{"uid": "12"}]},
            {"uids": [{"uid": "12345678901"}, "wrong"]},
        ]
        for payload in bad_payloads:
            with self.subTest(payload=str(payload)[:80]):
                res = self.client.post("/api/fb/uid/fetch", json=payload)
                self.assertEqual(res.status_code, 400)

    def test_lookup_strips_uid_password_but_uses_opt_in_session(self):
        stub = {
            "status": "success", "name": "Test Person",
            "username": "testperson", "profile_pic": None,
            "follower_count": None, "has_instagram": False,
        }
        with patch("fb_server.fetch_uid_info", return_value=stub) as fetcher:
            res = self.client.post("/api/fb/uid/fetch", json={
                "uids": [{"uid": "100000000000000", "password": "do-not-echo"}],
                "cookie": "sensitive-cookie=not-allowed",
            })
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json["success"])
        self.assertEqual(res.json["results"][0]["uid"], "100000000000000")
        self.assertNotIn("password", res.json["results"][0])
        self.assertNotIn("do-not-echo", res.get_data(as_text=True))
        self.assertNotIn("sensitive-cookie", res.get_data(as_text=True))
        fetcher.assert_called_once_with("100000000000000", {"sensitive-cookie": "not-allowed"})

    def test_cookie_fallback_to_server_configuration(self):
        stub = {"status": "error", "name": None, "username": None,
                "profile_pic": None, "follower_count": None,
                "has_instagram": False}
        with patch.dict("os.environ", {"FB_DEFAULT_COOKIE": "c_user=12345; xs=abc"}, clear=False):
            with patch("fb_server.fetch_uid_info", return_value=stub) as fetcher:
                res = self.client.post("/api/fb/uid/fetch", json={
                    "uids": [{"uid": "100000000000000"}],
                })
        self.assertEqual(res.status_code, 200)
        fetcher.assert_called_once_with("100000000000000",
                                        {"c_user": "12345", "xs": "abc"})

    def test_rejects_malformed_and_excessive_cookie(self):
        for invalid in [1, ["cookie=abc"], "a" * 8193]:
            res = self.client.post("/api/fb/uid/fetch", json={
                "uids": [{"uid": "100000000000000"}],
                "cookie": invalid,
            })
            self.assertEqual(res.status_code, 400)

    def test_legacy_30_uid_batch_accepted_without_network(self):
        stub = {"status": "success", "name": "Demo", "username": "demo",
                "profile_pic": None, "follower_count": 0, "has_instagram": False}
        uids = [{"uid": "100" + str(i).zfill(12)} for i in range(30)]
        with patch("fb_server.fetch_uid_info", return_value=stub) as fetcher:
            res = self.client.post("/api/fb/uid/fetch", json={"uids": uids})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json["results"]), 30)
        self.assertEqual(fetcher.call_count, 30)

    def test_session_is_sent_to_primary_profile_lookup(self):
        html = ('<html><head><title>Demo | Facebook</title>'
                '<meta property="og:url" content="https://www.facebook.com/demo"/>'
                '</head></html>')
        fake = SimpleNamespace(status_code=200,
                               url="https://m.facebook.com/profile.php?id=100000000000000",
                               text=html)
        with patch("fb_server.requests.get", return_value=fake) as getter:
            result = get_public_info("100000000000000", {"c_user": "example"})
        self.assertEqual(result["name"], "Demo")
        self.assertEqual(getter.call_args.kwargs["cookies"], {"c_user": "example"})

    def test_old_mbasic_result_fallback_if_public_login_redirect(self):
        from fb_server import fetch_uid_info
        with patch("fb_server.get_public_info", return_value={}):
            with patch("fb_server.get_followers_with_cookies", return_value={
                "name": "Example Account", "profile_pic": "https://scontent.xx.fbcdn.net/example.jpg",
                "follower_count": 1234,
            }):
                profile = fetch_uid_info("100000000000000", {"c_user": "example"})
        self.assertEqual(profile["status"], "success")
        self.assertEqual(profile["name"], "Example Account")
        self.assertEqual(profile["follower_count"], 1234)

    def test_public_og_metadata_parser(self):
        page = (
            '<html><head><title>Test Person | Facebook</title>'
            '<meta property="og:title" content="Test Person"/>'
            '<meta property="og:url" content="https://www.facebook.com/test.user"/>'
            '<meta property="og:image" content="https://scontent.xx.fbcdn.net/pic.jpg"/>'
            '<meta property="og:description" content="1,234 followers"/>'
            '</head></html>'
        )
        fake = SimpleNamespace(
            status_code=200,
            url="https://m.facebook.com/profile.php?id=100000000000000",
            text=page,
        )
        with patch("fb_server.requests.get", return_value=fake):
            result = get_public_info("100000000000000")
        self.assertEqual(result["name"], "Test Person")
        self.assertEqual(result["username"], "test.user")
        self.assertEqual(result["follower_count"], 1234)
        self.assertTrue(result["profile_pic"].startswith("https://"))

    def test_login_page_rejected(self):
        fake = SimpleNamespace(
            status_code=200,
            url="https://www.facebook.com/profile.php?id=100000000000000",
            text='<title>Log in to Facebook</title><meta property="og:image" content="https://scontent.xx.fbcdn.net/logo.jpg"/>',
        )
        with patch("fb_server.requests.get", return_value=fake):
            result = get_public_info("100000000000000")
        self.assertFalse(result)

    def test_public_avatar_url_validation(self):
        self.assertTrue(_valid_fb_image("https://scontent.xx.fbcdn.net/img.jpg"))
        self.assertFalse(_valid_fb_image("http://scontent.xx.fbcdn.net/img.jpg"))
        self.assertFalse(_valid_fb_image("https://fbcdn.net.attacker.invalid/img.jpg"))
        self.assertFalse(_valid_fb_image("https://example.com/avatar.png"))

    def test_no_unknown_api_spa_fallback(self):
        res = self.client.get("/api/missing-endpoint")
        self.assertEqual(res.status_code, 404)

    def test_deep_link_serves_react(self):
        res = self.client.get("/import")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b'<div id="root">', res.data)


if __name__ == "__main__":
    unittest.main()
