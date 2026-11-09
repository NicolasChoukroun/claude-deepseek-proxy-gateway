# DeepSeek Anthropic Gateway

A lightweight, zero-dependency Node.js reverse proxy that translates Anthropic API requests (e.g., from Claude Desktop or MCP clients) into DeepSeek API requests, allowing you to use DeepSeek's V4.1 models while logging the exact model used for every call.

---

## Security & API Key Safety

**Is your API key safe?**
Yes. The gateway script does **not** hardcode or expose your API key in the source code. Instead, it reads the key at runtime from an environment variable (`process.env.DEEPSEEK_API_KEY`). The key is transmitted strictly via standard encrypted HTTPS headers directly to `api.deepseek.com`.

---

## Adding Your API Key

You can supply your API key to the gateway using any of the following methods:

### Option 1: Terminal Environment Variable

Set the variable in your terminal session before launching the script:

* **macOS / Linux:**
  ```bash
  export DEEPSEEK_API_KEY="your_actual_api_key_here"
  node deepseek-anthropic-gateway.js
  ```

* **Windows PowerShell:**
  ```powershell
  $env:DEEPSEEK_API_KEY="your_actual_api_key_here"
  node deepseek-anthropic-gateway.js
  ```

* **Windows Command Prompt (CMD):**
  ```cmd
  set DEEPSEEK_API_KEY=your_actual_api_key_here
  node deepseek-anthropic-gateway.js
  ```

### Option 2: Using a `.env` File (Node.js Native)

If you prefer not to export environment variables every time:

1. Create a file named `.env` in the same directory as the script:
   ```env
   DEEPSEEK_API_KEY=your_actual_api_key_here
   PORT=8787
   ```
2. Run the script using Node's native env loader (Node v20.6+):
   ```bash
   node --env-file=.env deepseek-anthropic-gateway.js
   ```

> ⚠️ **Security Tip:** If you commit your project to a public repository like GitHub, always add `.env` to your `.gitignore` file to avoid accidentally pushing your secret credentials.

---

## Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `DEEPSEEK_API_KEY` | **Yes** | — | Your DeepSeek API secret key |
| `PORT` | No | `8787` | Local port for the gateway server |
| `DEEPSEEK_MODEL` | No | — | Optional global override for all requests (e.g., `deepseek-v4.1-flash`) |

---

## Connecting Claude Desktop

Configure Claude Desktop to route Anthropic API requests through your local proxy by setting `ANTHROPIC_BASE_URL`:

### macOS
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
open /Applications/Claude.app
```

### Windows (PowerShell)
```powershell
$env:ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
Start-Process "Claude.exe"
```

---

## Verification & Model Tracking Logs

When Claude Desktop or an MCP client sends requests, the gateway prints the exact model resolution in real-time:

```text
DeepSeek Anthropic gateway listening on http://127.0.0.1:8787
Model mapping:
  claude-3-7-sonnet-20250219 -> deepseek-v4.1-pro
  claude-3-5-sonnet-20241022 -> deepseek-v4.1-pro
  claude-3-5-haiku-20241022  -> deepseek-v4.1-flash

[2026-11-09T12:24:00.123Z] HTTP 200 | Client Requested: "claude-3-5-sonnet-20241022" | DeepSeek Model Used: "deepseek-v4.1-pro"
```

In addition, each proxy response includes the custom response header `x-gateway-deepseek-model` for easy inspection in network tools.

---

## License

MIT