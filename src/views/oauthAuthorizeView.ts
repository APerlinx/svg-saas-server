interface OAuthAuthorizeViewParams {
  client_id: string
  redirect_uri: string
  code_challenge: string
  code_challenge_method: string
  scope: string
  state: string
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function oauthAuthorizeView(params: OAuthAuthorizeViewParams): string {
  const {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    scope,
    state,
  } = params

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ChatSVG — MCP Authorization</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f0f0f;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e5e5e5;
    }

    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }

    .logo {
      font-size: 22px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 4px;
    }

    .logo span { color: #c55a30; }

    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      color: #c55a30;
      background: rgba(197,90,48,0.12);
      border: 1px solid rgba(197,90,48,0.25);
      border-radius: 20px;
      padding: 2px 10px;
      margin-bottom: 28px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    h1 {
      font-size: 20px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 10px;
    }

    p {
      font-size: 14px;
      color: #888;
      line-height: 1.6;
      margin-bottom: 24px;
    }

    p a { color: #c55a30; text-decoration: none; }
    p a:hover { text-decoration: underline; }

    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #aaa;
      margin-bottom: 8px;
    }

    input[type="text"] {
      width: 100%;
      padding: 12px 14px;
      background: #111;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      outline: none;
      transition: border-color 0.2s;
      margin-bottom: 20px;
    }

    input[type="text"]:focus { border-color: #c55a30; }
    input[type="text"]::placeholder { color: #444; }

    button {
      width: 100%;
      padding: 13px;
      background: #c55a30;
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.2s;
    }

    button:hover { background: #b04a24; }

    .footer {
      margin-top: 20px;
      font-size: 12px;
      color: #555;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Chat<span>SVG</span></div>
    <div class="badge">MCP Authorization</div>
    <h1>Connect your AI assistant</h1>
    <p>
      Paste your ChatSVG API key below to authorize access.<br/>
      Don't have a key yet?
      <a href="https://chatsvg.dev/api-keys" target="_blank">Create one here</a>.
    </p>
    <form method="POST" action="/oauth/authorize">
      <label for="api_key">API Key</label>
      <input
        type="text"
        id="api_key"
        name="api_key"
        placeholder="sk_live_..."
        required
        autocomplete="off"
        spellcheck="false"
      />
      <input type="hidden" name="client_id" value="${escape(client_id)}" />
      <input type="hidden" name="redirect_uri" value="${escape(redirect_uri)}" />
      <input type="hidden" name="code_challenge" value="${escape(code_challenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escape(code_challenge_method)}" />
      <input type="hidden" name="scope" value="${escape(scope)}" />
      <input type="hidden" name="state" value="${escape(state)}" />
      <button type="submit">Authorize</button>
    </form>
    <div class="footer">ChatSVG &mdash; chatsvg.dev</div>
  </div>
</body>
</html>`
}
