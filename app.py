import os
import sys
import time
import hmac
import logging
from datetime import datetime
from dotenv import load_dotenv
from flask import (
    Flask,
    Response,
    render_template,
    request,
    abort,
    stream_with_context,
    make_response,
)
from werkzeug.middleware.proxy_fix import ProxyFix

# 環境変数の読み込み (.env ファイルがあれば優先読み込み)
load_dotenv()

app = Flask(__name__)

# リバースプロキシ環境下（Nginx, Caddy, Gunicornなど）で正確なクライアントIPを取得するための設定
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

# ログの設定（標準出力およびファイルへ詳細ログを記録）
log_formatter = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
)

# コンソールハンドラー
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)

# ファイルハンドラー
file_handler = logging.FileHandler("download_access.log", encoding="utf-8")
file_handler.setFormatter(log_formatter)

logger = logging.getLogger("dummy_download_server")
logger.setLevel(logging.INFO)
logger.addHandler(console_handler)
logger.addHandler(file_handler)

# 許容される定義済みファイルサイズ (バイト数)
# 1GB = 1,000,000,000 バイト（10進数計算）
ALLOWED_SIZES = {
    "100MB": 100 * 1_000 * 1_000,       # 100,000,000 bytes
    "500MB": 500 * 1_000 * 1_000,       # 500,000,000 bytes
    "1GB": 1_000 * 1_000 * 1_000,       # 1,000,000,000 bytes
}


def get_configured_token():
    """環境変数からDOWNLOAD_TOKENを取得します。未設定の場合はNone"""
    token = os.getenv("DOWNLOAD_TOKEN", "").strip()
    return token if token else None


def is_token_valid(provided_token):
    """トークン一致の安全な検証（タイミング攻撃対策）"""
    configured_token = get_configured_token()
    # トークンが未設定の場合は全アクセス許可
    if not configured_token:
        return True
    if not provided_token:
        return False
    return hmac.compare_digest(provided_token.strip(), configured_token)


def get_client_ip():
    """リクエストのクライアントIPアドレスを取得"""
    if request.headers.get("X-Forwarded-For"):
        # 先頭のIPがオリジナルのクライアントIP
        return request.headers.get("X-Forwarded-For").split(",")[0].strip()
    return request.remote_addr or "127.0.0.1"


@app.after_request
def add_no_cache_headers(response):
    """全レスポンスに対して強力なキャッシュ無効化ヘッダーを付与"""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.route("/")
def index():
    provided_token = request.args.get("token", "").strip()
    configured_token = get_configured_token()
    token_required = configured_token is not None

    authorized = True
    if token_required:
        authorized = is_token_valid(provided_token)

    return render_template(
        "index.html",
        authorized=authorized,
        token_required=token_required,
        provided_token=provided_token,
        sizes=ALLOWED_SIZES,
    )


def generate_dummy_stream(total_bytes, client_ip, user_agent, size_label):
    """
    指定バイト数の非圧縮（高エントロピー）ランダムデータをストリーミング生成します。
    RAMに全データを乗せず、128KBのチャンク単位で送信します。
    """
    start_time = time.time()
    bytes_sent = 0
    chunk_size = 128 * 1024  # 128 KB チャンク

    try:
        while bytes_sent < total_bytes:
            remaining = total_bytes - bytes_sent
            current_chunk_size = min(chunk_size, remaining)
            # os.urandomでエントロピーが非常に高いランダムバイト列を生成（圧縮不可能）
            chunk = os.urandom(current_chunk_size)
            bytes_sent += len(chunk)
            yield chunk
    except GeneratorExit:
        logger.info(f"Client disconnected early for size '{size_label}' (IP: {client_ip})")
    except Exception as e:
        logger.error(f"Streaming error for size '{size_label}' (IP: {client_ip}): {e}")
    finally:
        duration = time.time() - start_time
        mb_sent = bytes_sent / 1_000_000.0
        speed_mbs = (mb_sent / duration) if duration > 0 else 0
        speed_mbps = (bytes_sent * 8 / 1_000_000.0 / duration) if duration > 0 else 0

        # 詳細ログ出力
        logger.info(
            f"[DOWNLOAD COMPLETE] "
            f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | "
            f"Client IP: {client_ip} | "
            f"User-Agent: \"{user_agent}\" | "
            f"Selected Size: {size_label} | "
            f"Sent Bytes: {bytes_sent:,} / {total_bytes:,} bytes ({mb_sent:.2f} MB) | "
            f"Time: {duration:.2f}s | "
            f"Avg Speed: {speed_mbs:.2f} MB/s ({speed_mbps:.2f} Mbps)"
        )


@app.route("/download/<size_label>")
def download(size_label):
    # トークン検証
    provided_token = request.args.get("token", "").strip()
    if get_configured_token() and not is_token_valid(provided_token):
        logger.warning(f"Unauthorized download attempt for size '{size_label}' from IP: {get_client_ip()}")
        return make_response(("Unauthorized: Invalid or missing token.", 403))

    # ファイルサイズのチェック
    if size_label not in ALLOWED_SIZES:
        abort(404, description="指定されたファイルサイズは存在しません。")

    total_bytes = ALLOWED_SIZES[size_label]
    client_ip = get_client_ip()
    user_agent = request.headers.get("User-Agent", "Unknown")

    logger.info(
        f"[DOWNLOAD START] Request for {size_label} ({total_bytes:,} bytes) from IP: {client_ip}"
    )

    # ストリーミングレスポンスの生成
    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"dummy_{size_label}_{timestamp_str}.bin"

    headers = {
        "Content-Length": str(total_bytes),
        "Content-Type": "application/octet-stream",
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Content-Type-Options": "nosniff",
    }

    return Response(
        stream_with_context(
            generate_dummy_stream(total_bytes, client_ip, user_agent, size_label)
        ),
        headers=headers,
        mimetype="application/octet-stream",
    )


if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 5000))
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    print(f"Starting server on http://{host}:{port} ...")
    app.run(host=host, port=port, debug=False)
