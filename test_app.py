import os
import unittest
import app as flask_app


class DummyServerTestCase(unittest.TestCase):
    def setUp(self):
        flask_app.app.config["TESTING"] = True
        self.client = flask_app.app.test_client()
        # テスト用環境変数のリセット
        os.environ["DOWNLOAD_TOKEN"] = "test-token-12345"

    def test_index_unauthorized_when_token_set(self):
        """トークン未設定でアクセスした場合の不整合（未認証状態）テスト"""
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("🔐 アクセス制限".encode("utf-8"), response.data)

    def test_index_authorized_with_correct_token(self):
        """正しいトークンでアクセスした場合の認証成功テスト"""
        response = self.client.get("/?token=test-token-12345")
        self.assertEqual(response.status_code, 200)
        self.assertIn("モバイルデータ通信量テスト".encode("utf-8"), response.data)
        self.assertIn("100MBをダウンロード".encode("utf-8"), response.data)

    def test_download_unauthorized(self):
        """トークン不一致でのダウンロード拒否 (403 Forbidden) テスト"""
        response = self.client.get("/download/100MB?token=wrong_token")
        self.assertEqual(response.status_code, 403)

    def test_download_headers_100mb(self):
        """100MB ダウンロード時のヘッダーおよびContent-Length検証"""
        response = self.client.get("/download/100MB?token=test-token-12345")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Content-Length"), "100000000")
        self.assertEqual(response.headers.get("Content-Type"), "application/octet-stream")
        self.assertIn("attachment; filename=\"dummy_100MB_", response.headers.get("Content-Disposition"))
        self.assertIn("no-store", response.headers.get("Cache-Control"))
        self.assertEqual(response.headers.get("Pragma"), "no-cache")

    def test_download_headers_500mb(self):
        """500MB ダウンロード時のヘッダーおよびContent-Length検証"""
        response = self.client.get("/download/500MB?token=test-token-12345")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Content-Length"), "500000000")

    def test_download_headers_1gb(self):
        """1GB (1,000,000,000 bytes) ダウンロード時のヘッダーおよびContent-Length検証"""
        response = self.client.get("/download/1GB?token=test-token-12345")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Content-Length"), "1000000000")

    def test_partial_stream_reading(self):
        """実際にストリームの一部（最初と最後の数チャンク）を消費し動作確認"""
        response = self.client.get("/download/100MB?token=test-token-12345", buffered=False)
        self.assertEqual(response.status_code, 200)
        
        # 最初の128KBチャンクのみ読み込んで切断をシミュレート
        chunk = next(response.response)
        self.assertEqual(len(chunk), 128 * 1024)
        response.close()


if __name__ == "__main__":
    unittest.main()
