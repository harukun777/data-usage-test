# 大容量ダミーファイル配布サーバー (モバイルデータ通信量測定用)

スマートフォン等のモバイル通信（4G/5G）において、実際のデータ通信量を正確に測定・検証するための Flask Web アプリケーションです。

> **💡 GitHub Pages で公開したい場合について**  
> GitHub Pages は **静的ファイル (HTML/CSS/JS) 専用ホスティング** のため、Python/Flask のサーバー処理や動的ストリーミング、サーバー側での通信ログ記録を GitHub Pages 単体で動かすことはできません。  
> GitHub Pages を利用する場合は、**「GitHub Pages (UI) ＋ 無料クラウドサーバー (Render.com 等で Flask 稼働)」** の組み合わせにするか、**Render.com や Railway にまとめてデプロイ** するのが最も簡単でおすすめです。（詳細は下記「9. GitHub Pages / クラウド環境への公開方法」を参照）


## 特長・仕組み

- **非圧縮・高エントロピーデータ**: `os.urandom` による疑似乱数バイト列をストリーミング生成します。データエントロピーが最高レベル（理論限界に近い8bit/byte）のため、gzip/Brotliなどの圧縮アルゴリズムで圧縮されず、実際の転送量が物理ネットワークにそのまま流れます。
- **Zero-Disk / Small Memory Footprint**: 事前に巨大ファイルをディスクに作成する必要がありません。また、全体をRAMに載せず128KBのチャンク単位で動的に生成して応答するため、サーバーのメモリ消費量は僅か数メガバイトで安定稼働します。
- **正確な Content-Length**: 100MB (`100,000,000 bytes`), 500MB (`500,000,000 bytes`), 1GB (`1,000,000,000 bytes`) の `Content-Length` を正確に設定して返します。
- **リアルタイム通信ログ**: ダウンロード完了時または途中でクライアントが接続を切断・キャンセルした場合も、実際に送信されたバイト数、所要時間、平均転送速度 (MB/s, Mbps) を記録します。
- **キャッシュ無効化**: 強力な HTTP キャッシュ制御ヘッダー (`Cache-Control: no-store, no-cache, must-revalidate, max-age=0`) を付与し、CDNやブラウザによるキャッシュを防止します。
- **トークン認証**: `DOWNLOAD_TOKEN` を設定することで、特定URL (`?token=xxxxx`) からのみアクセスを許可できます。

---

## 1. Python仮想環境の作成

プロジェクト直下で以下のコマンドを実行し、Python 3の仮想環境（`venv`）を作成します。

```bash
# Windows
python -m venv venv

# macOS / Linux
python3 -m venv venv
```

仮想環境を有効化します。

```bash
# Windows (PowerShell)
.\venv\Scripts\Activate.ps1

# Windows (cmd.exe)
.\venv\Scripts\activate.bat

# macOS / Linux (bash/zsh)
source venv/bin/activate
```

---

## 2. 依存パッケージのインストール

`requirements.txt` から必要なライブラリ（Flask, python-dotenv, gunicorn）をインストールします。

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 3. DOWNLOAD_TOKENの設定

本サーバーを公開環境に置く場合、第三者による無制限の帯域消費を防ぐためにトークン認証を設定することを強く推奨します。

1. `.env.example` をコピーして `.env` ファイルを作成します。

```bash
# Linux / macOS
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env
```

2. `.env` ファイルをテキストエディタで開き、`DOWNLOAD_TOKEN` に任意のランダム文字列を設定します。

```env
DOWNLOAD_TOKEN=my_super_secret_token_2026
FLASK_PORT=5000
FLASK_HOST=0.0.0.0
```

> **注意**: `DOWNLOAD_TOKEN` を空または未設定（コメントアウト）にした場合は、トークンなしで誰でもダウンロード可能になります。

---

## 4. Flaskサーバーの起動 (開発・検証用)

```bash
python app.py
```

ブラウザで以下のアドレスにアクセスします。

- トークンを設定していない場合: `http://localhost:5000/`
- トークンを設定した場合: `http://localhost:5000/?token=my_super_secret_token_2026`

---

## 5. 本番環境でGunicornを使う方法

本番環境（Linux）でマルチスレッド/マルチプロセス並行処理を行う場合は、WSGIサーバーである **Gunicorn** を使用します。

ストリーミング配信および複数同時クライアントからの接続に対応するため、`gthreads` ワーカーまたはスレッド数を適切に設定します。

```bash
# 4ワーカー、各2スレッドで起動する例
gunicorn --workers 4 --threads 2 --bind 0.0.0.0:5000 --timeout 600 app:app
```

> **ポイント**: 1GBファイルなどのダウンロードには時間がかかるため、`--timeout 600` （10分）など、タイムアウト時間を長めに設定してください。

---

## 6. Caddy / Nginx でリバースプロキシする場合の設定例

リバースプロキシ（Nginx や Caddy、Cloudflareなど）を経由する場合、以下の点に注意が必要です：

1. **レスポンス圧縮（gzip/brotli/zstd）の無効化**: プロキシ層で圧縮を行おうとすると余計なCPU負荷がかかり、また `Content-Length` ヘッダーが削除される可能性があります。
2. **バッファリングの無効化**: 大容量ストリーミングの遅延を防ぐため、レスポンスバッファリングを無効化します。

### Nginx 設定例

`/etc/nginx/sites-available/dummy-server` に以下のように記述します：

```nginx
server {
    listen 80;
    server_name example.com;

    # SSLを設定する場合は listen 443 ssl; を併用

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 【重要】圧縮を無効化
        gzip off;

        # 【重要】レスポンスバッファリングを無効化（即時ストリーミング）
        proxy_buffering off;

        # タイムアウト時間の延長 (大容量ダウンロード用)
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

### Caddy 設定例

`Caddyfile`:

```caddyfile
example.com {
    reverse_proxy 127.0.0.1:5000 {
        # レスポンスバッファリングの無効化
        flush_interval -1
    }

    # 圧縮エンコーディングから除外
    encode {
        match {
            not path /download/*
        }
        gzip zstd
    }
}
```

---

## 7. systemd で常駐させる場合の設定例

Linuxサーバー（Ubuntu / Debian / RHEL 等）でサーバー起動時に自動実行させるため、`systemd` サービスを作成します。

`/etc/systemd/system/dummy-download.service` を作成：

```ini
[Unit]
Description=Dummy File Distribution Server for Mobile Data Testing
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/giga-test
Environment="PATH=/var/www/giga-test/venv/bin"
ExecStart=/var/www/giga-test/venv/bin/gunicorn --workers 4 --threads 2 --bind 127.0.0.1:5000 --timeout 600 app:app
Restart=always
RestartSec=5

[StandardOutput]
journal

[StandardError]
journal

[Install]
WantedBy=multi-user.target
```

有効化と起動：

```bash
sudo systemctl daemon-reload
sudo systemctl enable dummy-download
sudo systemctl start dummy-download

# ステータス確認
sudo systemctl status dummy-download
```

---

## 8. モバイル回線で正確に通信量を測定する際の注意点

スマートフォンの4G/5G通信量を正確に測定・検証するために、以下の点に注意してください。

1. **Wi-Fi接続の切断**
   - 必ずスマートフォンのWi-FiをOFFにし、4G/5G/LTE回線で接続されていることを確認してください。
2. **バックグラウンド通信の影響排除**
   - アプリの自動更新（App Store / Google Play）、OSのアップデート、SNS・クラウド同期などのバックグラウンド通信を一時的に停止してください。
3. **キャリヤやOSの通信量カウンターの確認**
   - テスト開始前と開始後に、OS設定画面の「モバイル通信」またはキャリアマイページ（My docomo, my au, My SoftBank, 楽天モバイル等）の通信量ログをメモしてください。
4. **Cloudflare / Private Relay / VPN のオフ**
   - iOSの「iCloudプライベートリレー」や各種VPN（1.1.1.1等）が有効になっていると、プロキシサーバーを中間経由するため、通信速度の測定精度に影響したりプロキシ圧縮が発生する場合があります。テスト時はオフにしてください。
5. **測定ログの確認**
   - サーバー側の `download_access.log` にログがリアルタイムで出力されます。クライアントIP、実送信バイト数、所要時間、平均通信速度（MB/s / Mbps）を確認できます。

---

## ログ形式の例

`download_access.log` または標準出力に以下のフォーマットでログが記録されます：

```text
2026-09-26 18:00:00 [INFO] [DOWNLOAD START] Request for 100MB (100,000,000 bytes) from IP: 203.0.113.45
2026-09-26 18:00:05 [INFO] [DOWNLOAD COMPLETE] Date: 2026-09-26 18:00:05 | Client IP: 203.0.113.45 | User-Agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)..." | Selected Size: 100MB | Sent Bytes: 100,000,000 / 100,000,000 bytes (100.00 MB) | Time: 5.21s | Avg Speed: 19.19 MB/s (153.55 Mbps)
```

---

## 9. GitHub Pages / クラウド環境への公開方法

### なぜ GitHub Pages だけでは動作しないのか？
GitHub Pages は **静的ファイル (HTML/CSS/JS) 専用のホスティング** です。  
Python などのサーバーサイドプログラムを動作させることができないため、**Flask によるリアルタイム非圧縮データストリーミング** や **サーバー側ログ保存** を GitHub Pages 単体で動かすことはできません。

また、ブラウザ上の JavaScript のみで 1GB のランダムデータを生成しても、それは **端末ローカルのメモリ内で生成されるため、モバイル通信量（ギガ）は消費されません**。

---

### おすすめの公開パターン 2選

#### パターン A: Render.com（無料クラウド）に一括デプロイ（最も簡単）
フロント（UI）もバックエンド（Flask）もまとめて Render.com などの無料 Pass プラットフォームにデプロイする方法です。

1. **GitHub にリポジトリを作成**
   このプロジェクトのコード一式を GitHub リポジトリに push します。
2. **Render.com にサインアップ**
   [https://render.com/](https://render.com/) にアクセスし、アカウントを作成します。
3. **新規 Web Service を作成**
   - 「New +」→「Web Service」を選択
   - 自分の GitHub リポジトリを連携
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app`
   - **Environment Variables**:
     `DOWNLOAD_TOKEN`: `任意のトークン文字列`
4. **デプロイ完了**
   発行される URL（例: `https://giga-test.onrender.com/?token=your_token`）へアクセスすれば、スマホから即座に通信量テストを行えます。

---

#### パターン B: UI は GitHub Pages ＋ ダウンロード処理は クラウドサーバー
UI（HTML）のみを GitHub Pages でホストし、ダウンロードボタンのリンク先を自前の Flask サーバー URL（Render や VPS）に指定する構成です。

1. **`index.html` 内のダウンロード URL を変更**
   各ダウンロードリンク（`href`）を、クラウドサーバーの絶対パスにします：
   `https://your-flask-server.onrender.com/download/100MB?token=xxx`
2. **CORS ヘッダーの許可（必要に応じて）**
   同一ドメイン外から直接アンカータグ `<a href="...">` でダウンロードさせる場合は、通常のリンク遷移となるため CORS の設定も不要でそのまま動作します。
3. **GitHub Pages の設定**
   GitHub リポジトリの `Settings` → `Pages` から `main` ブランチを選択して公開します。

