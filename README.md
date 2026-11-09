# DeepSeek Anthropic Gateway

A zero-dependency Node.js reverse proxy that lets Claude Code and Claude Desktop talk to DeepSeek's latest models (`deepseek-flash` and `deepseek-v4-pro`) through DeepSeek's Anthropic-compatible endpoint. Every request is logged with the exact model that was used.

---

## Why This Exists

DeepSeek's Anthropic endpoint (`https://api.deepseek.com/anthropic`) is compatible with the Anthropic Messages API, but Claude clients often send model names that DeepSeek does not recognize directly. This gateway sits between your client and DeepSeek, normalizes the request, and maps Claude model names to the correct DeepSeek model according to DeepSeek's official rules.

**Official mapping rules:**

| Client requests | Gateway sends |
|:---|:---|
| `claude-opus*` | `deepseek-v4-pro` |
| `claude-sonnet*` / `claude-haiku*` | `deepseek-flash` |
| Other `claude*` names | `deepseek-flash` |
| `deepseek-flash` / `deepseek-v4-pro` | Passed through unchanged |

---

## Quick Start

```bash
# 1. Set your API key
export DEEPSEEK_API_KEY="sk-your-key-here"

# 2. Start the gateway (Node 18+ required for native fetch)
node deepseek-anthropic-gateway.js

# 3. Point your Claude client to the gateway
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
