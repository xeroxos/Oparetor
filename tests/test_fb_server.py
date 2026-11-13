"""Network-free regression checks for the production UID Operator Flask API."""
import unittest
from unittest.mock import patch

from fb_server import app, _valid_fb_image


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
            {"uids": [{"uid": "12345678901"}] * 16},
            {"uids": [{"uid": "12"}]},
            {"uids": [{"uid": "12345678901"}, "wrong"]},
        ]
        for payload in bad_payloads:
            with self.subTest(payload=str(payload)[:80]):
                res = self.client.post("/api/fb/uid/fetch", json=payload)
                self.assertEqual(res.status_code, 400)

    def test_lookup_strips_credentials_and_uses_public_data_only(self):
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
        fetcher.assert_called_once_with("100000000000000", None)

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
