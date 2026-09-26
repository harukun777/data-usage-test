// Cloudflare Workers用 モバイルデータ通信量測定サーバー
// 高エントロピー疑似乱数のストリーミング生成による大容量非圧縮ダミーファイル配布

const ALLOWED_SIZES = {
  "100MB": 100 * 1_000 * 1_000,       // 100,000,000 bytes
  "500MB": 500 * 1_000 * 1_000,       // 500,000,000 bytes
  "1GB": 1_000 * 1_000 * 1_000,       // 1,000,000,000 bytes
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const providedToken = (url.searchParams.get("token") || "").trim();

    const configuredToken = (env.DOWNLOAD_TOKEN || "").trim();
    const tokenRequired = configuredToken.length > 0;
    const authorized = !tokenRequired || (providedToken === configuredToken);

    // キャッシュを一切許可しない無効化ヘッダー
    const defaultHeaders = {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    };

    // 1. トップページレスポンス
    if (pathname === "/" || pathname === "/index.html") {
      const html = renderHTML(authorized, tokenRequired, providedToken);
      return new Response(html, {
        status: 200,
        headers: {
          ...defaultHeaders,
          "Content-Type": "text/html; charset=UTF-8",
        },
      });
    }

    // 2. ダミーファイルストリーミングダウンロードレスポンス
    if (pathname.startsWith("/download/")) {
      if (!authorized) {
        return new Response("Unauthorized: Invalid or missing token.", {
          status: 403,
          headers: defaultHeaders,
        });
      }

      const sizeLabel = pathname.replace("/download/", "");
      if (!ALLOWED_SIZES[sizeLabel]) {
        return new Response("Not Found: Specified size does not exist.", {
          status: 404,
          headers: defaultHeaders,
        });
      }

      const totalBytes = ALLOWED_SIZES[sizeLabel];
      const timestampStr = new Date().toISOString().replace(/[:.-]/g, "_");
      const filename = `dummy_${sizeLabel}_${timestampStr}.bin`;

      // Cloudflare Edge Stream (ReadableStream) による非圧縮ランダムデータ動的ストリーミング
      // pull(controller) を使用することでバックプレッシャー（通信速度に応じた制御）を適用し、
      // メモリ制限超過や途中切断（~7MB制限）を防いで1GBまで確実に配信します。
      let bytesSent = 0;
      const chunkSize = 64 * 1024; // 64KB (Web Crypto Limit per call)

      const stream = new ReadableStream({
        pull(controller) {
          try {
            // クライアントの読み込みバッファ（desiredSize）に合わせてチャンクを出力
            while (bytesSent < totalBytes && (controller.desiredSize === null || controller.desiredSize > 0)) {
              const remaining = totalBytes - bytesSent;
              const currentChunkSize = Math.min(chunkSize, remaining);
              const chunk = new Uint8Array(currentChunkSize);

              // 暗号学的に安全な乱数（圧縮不可能な最高エントロピーデータ）
              crypto.getRandomValues(chunk);

              bytesSent += currentChunkSize;
              controller.enqueue(chunk);
            }

            if (bytesSent >= totalBytes) {
              controller.close();
            }
          } catch (err) {
            controller.error(err);
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          ...defaultHeaders,
          "Content-Type": "application/octet-stream",
          "Content-Length": totalBytes.toString(),
          "Content-Disposition": `attachment; filename="${filename}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return new Response("Not Found", { status: 404, headers: defaultHeaders });
  },
};

function renderHTML(authorized, tokenRequired, providedToken) {
  const tokenParam = providedToken ? `?token=${encodeURIComponent(providedToken)}` : "";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>モバイルデータ通信量テスト (Cloudflare Edge)</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Noto+Sans+JP:wght@400;600;700;900&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0d1117;
            --card-bg: rgba(22, 27, 34, 0.85);
            --card-border: rgba(255, 255, 255, 0.1);
            --text-primary: #f0f6fc;
            --text-secondary: #8b949e;
            --accent-orange: #f97316;
            --accent-purple: #a855f7;
            --warning-bg: rgba(239, 68, 68, 0.15);
            --warning-border: rgba(239, 68, 68, 0.4);
            --warning-text: #fca5a5;
            --btn-gradient-1: linear-gradient(135deg, #2563eb, #3b82f6);
            --btn-gradient-2: linear-gradient(135deg, #7c3aed, #9333ea);
            --btn-gradient-3: linear-gradient(135deg, #db2777, #e11d48);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Plus Jakarta Sans', 'Noto Sans JP', sans-serif;
            background-color: var(--bg-color);
            background-image: 
                radial-gradient(circle at 20% 20%, rgba(249, 115, 22, 0.1) 0%, transparent 40%),
                radial-gradient(circle at 80% 80%, rgba(168, 85, 247, 0.1) 0%, transparent 40%);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 24px 16px 48px;
            -webkit-tap-highlight-color: transparent;
        }
        .container { width: 100%; max-width: 540px; }
        .header { text-align: center; margin-bottom: 28px; }
        .header-icon {
            width: 56px; height: 56px;
            background: linear-gradient(135deg, var(--accent-orange), var(--accent-purple));
            border-radius: 16px;
            display: inline-flex; align-items: center; justify-content: center;
            margin-bottom: 16px;
            box-shadow: 0 8px 24px rgba(249, 115, 22, 0.25);
        }
        .header-icon svg { width: 28px; height: 28px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
        h1 {
            font-size: 1.75rem; font-weight: 800; letter-spacing: -0.02em;
            background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
            -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
            margin-bottom: 8px;
        }
        .subtitle { font-size: 0.9rem; color: var(--text-secondary); }
        .warning-card {
            background: var(--warning-bg); border: 1px solid var(--warning-border);
            border-radius: 16px; padding: 18px 20px; margin-bottom: 28px;
            display: flex; align-items: flex-start; gap: 14px; backdrop-filter: blur(8px);
        }
        .warning-icon { flex-shrink: 0; width: 24px; height: 24px; color: #ef4444; margin-top: 2px; }
        .warning-text { font-size: 0.925rem; line-height: 1.55; color: var(--warning-text); font-weight: 600; }
        .auth-card {
            background: var(--card-bg); border: 1px solid var(--card-border);
            border-radius: 20px; padding: 28px 24px; text-align: center; backdrop-filter: blur(12px);
        }
        .auth-card h2 { font-size: 1.25rem; margin-bottom: 12px; }
        .auth-card p { font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 20px; }
        .token-form { display: flex; flex-direction: column; gap: 12px; }
        .token-input {
            width: 100%; padding: 14px 16px; border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.15); background: rgba(15, 23, 42, 0.6);
            color: #fff; font-size: 1rem; outline: none;
        }
        .token-submit-btn {
            width: 100%; padding: 14px; border-radius: 12px; border: none;
            background: var(--btn-gradient-1); color: #fff; font-weight: 700; font-size: 1rem; cursor: pointer;
        }
        .cards-list { display: flex; flex-direction: column; gap: 18px; }
        .download-card {
            background: var(--card-bg); border: 1px solid var(--card-border);
            border-radius: 20px; padding: 22px; backdrop-filter: blur(12px);
        }
        .card-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .size-label { font-size: 1.5rem; font-weight: 800; color: #ffffff; }
        .byte-count { font-size: 0.85rem; color: var(--text-secondary); font-family: monospace; }
        .size-desc { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 18px; }
        .download-btn {
            display: flex; align-items: center; justify-content: center; gap: 10px;
            width: 100%; padding: 16px 20px; border-radius: 14px; text-decoration: none;
            color: #ffffff; font-weight: 700; font-size: 1.05rem; border: none; cursor: pointer;
            box-shadow: 0 6px 18px rgba(0,0,0,0.25);
        }
        .download-btn.btn-100mb { background: var(--btn-gradient-1); }
        .download-btn.btn-500mb { background: var(--btn-gradient-2); }
        .download-btn.btn-1gb { background: var(--btn-gradient-3); }
        .download-btn svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2.2; }
        .footer { margin-top: 36px; text-align: center; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6; }
        .info-pill {
            display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px;
            background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.2);
            font-size: 0.775rem; color: #fdba74; margin-bottom: 20px;
        }
        .toast {
            position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(100px);
            background: rgba(30, 41, 59, 0.95); border: 1px solid rgba(255, 255, 255, 0.2);
            color: #fff; padding: 14px 22px; border-radius: 30px; font-size: 0.9rem; font-weight: 600;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px); transition: all 0.3s;
            opacity: 0; pointer-events: none; z-index: 100; display: flex; align-items: center; gap: 8px;
        }
        .toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="header-icon">
                <svg viewBox="0 0 24 24">
                    <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                    <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                </svg>
            </div>
            <h1>モバイルデータ通信量テスト</h1>
            <p class="subtitle">Cloudflare Edge 超高速配布サーバー</p>
        </header>

        ${!authorized ? `
        <div class="auth-card">
            <h2>🔐 アクセス制限</h2>
            <p>このサーバーを利用するにはアクセス用トークンが必要です。トークンを入力してください。</p>
            <form class="token-form" action="/" method="GET">
                <input type="password" name="token" class="token-input" placeholder="トークンを入力..." value="${providedToken}" required autofocus>
                <button type="submit" class="token-submit-btn">認証して進む</button>
            </form>
        </div>
        ` : `

        <div style="text-align: center;">
            <div class="info-pill">
                ⚡ Powered by Cloudflare Workers (Edge Streaming)
            </div>
        </div>

        <div class="warning-card">
            <svg class="warning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <div class="warning-text">
                Wi-FiをOFFにしてからダウンロードしてください。ダウンロードしたデータは通信量として消費されます。
            </div>
        </div>

        <div class="cards-list">
            <div class="download-card">
                <div class="card-header">
                    <div class="size-label">100 MB</div>
                    <div class="byte-count">100,000,000 bytes</div>
                </div>
                <div class="size-desc">軽量テスト・高速通信テスト用</div>
                <a href="/download/100MB${tokenParam}" class="download-btn btn-100mb" onclick="startNotify('100MB')">
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    100MBをダウンロード
                </a>
            </div>

            <div class="download-card">
                <div class="card-header">
                    <div class="size-label">500 MB</div>
                    <div class="byte-count">500,000,000 bytes</div>
                </div>
                <div class="size-desc">標準データ消費検証用</div>
                <a href="/download/500MB${tokenParam}" class="download-btn btn-500mb" onclick="startNotify('500MB')">
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    500MBをダウンロード
                </a>
            </div>

            <div class="download-card">
                <div class="card-header">
                    <div class="size-label">1 GB</div>
                    <div class="byte-count">1,000,000,000 bytes</div>
                </div>
                <div class="size-desc">大容量通信・ギガ消費テスト用</div>
                <a href="/download/1GB${tokenParam}" class="download-btn btn-1gb" onclick="startNotify('1GB')">
                    <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    1GBをダウンロード
                </a>
            </div>
        </div>
        `}

        <footer class="footer">
            <p>※1GB = 1,000,000,000 Bytes (10進数計算)</p>
            <p>データはメモリ/ディスクに保持されず、Cloudflare Edgeからストリーミング生成されます。</p>
        </footer>
    </div>

    <div id="toast" class="toast">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span id="toast-text">ダウンロードを開始しました</span>
    </div>

    <script>
        function startNotify(size) {
            const toast = document.getElementById('toast');
            const toastText = document.getElementById('toast-text');
            toastText.textContent = size + ' のダウンロードを開始しました。ブラウザのダウンロード通知をご確認ください。';
            toast.classList.add('show');
            setTimeout(function() { toast.classList.remove('show'); }, 4500);
        }
    </script>
</body>
</html>`;
}
