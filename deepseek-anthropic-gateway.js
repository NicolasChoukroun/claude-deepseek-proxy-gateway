const http = require("http");

const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";
const UPSTREAM = "https://api.deepseek.com/anthropic";
const API_KEY = process.env.DEEPSEEK_API_KEY;

// Official DeepSeek model names (as of docs)
const DEEPSEEK_FLASH = "deepseek-flash";
const DEEPSEEK_PRO = "deepseek-v4-pro";

// Official Anthropic model mapping rules:
// claude-opus*   -> deepseek-v4-pro
// claude-haiku*  -> deepseek-flash
// claude-sonnet* -> deepseek-flash
function mapClaudeModelToDeepSeek(requestedModel) {
  if (typeof requestedModel !== "string") return DEEPSEEK_FLASH;

  const lower = requestedModel.toLowerCase();

  // Allow direct DeepSeek model names to pass through
  if (lower === DEEPSEEK_FLASH || lower === DEEPSEEK_PRO) {
    return lower;
  }

  // Official Claude model mappings
  if (lower.startsWith("claude-opus")) {
    return DEEPSEEK_PRO;
  }
  if (lower.startsWith("claude-haiku") || lower.startsWith("claude-sonnet")) {
    return DEEPSEEK_FLASH;
  }

  // Any other unsupported claude* model falls back to flash per official docs
  if (lower.startsWith("claude")) {
    return DEEPSEEK_FLASH;
  }

  // Unknown non-claude model names: pass through and let upstream decide (or return 400)
  return requestedModel;
}

if (!API_KEY) {
  console.error("Missing DEEPSEEK_API_KEY. Set it before starting this gateway.");
  process.exit(1);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function normalizeSystemContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(block => block && block.type === "text" && typeof block.text === "string")
    .map(block => block.text)
    .join("\n\n");
}

function cleanContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;

  const cleaned = content
    .filter(block => {
      if (!block || typeof block !== "object") return true;
      return block.type !== "thinking" && block.type !== "redacted_thinking";
    })
    .map(block => {
      if (!block || typeof block !== "object") return block;
      const { thinking, signature, redacted_thinking, ...cleanedBlock } = block;
      return cleanedBlock;
    });

  return cleaned.length === 0 ? "" : cleaned;
}

function normalizeAnthropicRequest(body) {
  const systemParts = [];
  const messages = [];

  if (body.system) {
    systemParts.push(normalizeSystemContent(body.system));
  }

  for (const message of body.messages || []) {
    if (message.role === "system") {
      systemParts.push(normalizeSystemContent(message.content));
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;

    const { thinking, signature, ...cleanedMessage } = message;
    messages.push({
      ...cleanedMessage,
      content: cleanContent(message.content)
    });
  }

  const requestedModel = body.model || "unknown";
  const mappedModel = mapClaudeModelToDeepSeek(requestedModel);

  const normalized = {
    ...body,
    model: mappedModel,
    messages
  };

  if (systemParts.length > 0) {
    normalized.system = systemParts.filter(Boolean).join("\n\n");
  } else {
    delete normalized.system;
  }

  // DeepSeek Anthropic endpoint supports thinking enabled/disabled,
  // but not Anthropic's adaptive/thinking block structure for Claude
  delete normalized.thinking;
  delete normalized.output_config;

  return { normalized, requestedModel, mappedModel };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function proxyMessages(req, res) {
  const raw = await readRequestBody(req);
  const body = raw ? JSON.parse(raw) : {};
  const { normalized, requestedModel, mappedModel } = normalizeAnthropicRequest(body);

  const upstreamRes = await fetch(`${UPSTREAM}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": req.headers["anthropic-version"] || "2023-06-01"
    },
    body: JSON.stringify(normalized)
  });

  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}] HTTP ${upstreamRes.status} | Client Requested: "${requestedModel}" | DeepSeek Model Used: "${mappedModel}"`
  );

  const headers = {
    "content-type": upstreamRes.headers.get("content-type") || "application/json; charset=utf-8",
    "x-gateway-client-model": requestedModel,
    "x-gateway-deepseek-model": mappedModel
  };

  const cacheControl = upstreamRes.headers.get("cache-control");
  if (cacheControl) headers["cache-control"] = cacheControl;

  res.writeHead(upstreamRes.status, headers);

  if (!upstreamRes.body) {
    res.end(await upstreamRes.text());
    return;
  }

  const reader = upstreamRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/v1/models") {
      sendJson(res, 200, {
        data: [
          {
            id: "claude-sonnet-4-5",
            type: "model",
            display_name: "DeepSeek Flash (via Sonnet mapping)"
          },
          {
            id: "claude-opus-4-5",
            type: "model",
            display_name: "DeepSeek V4 Pro (via Opus mapping)"
          }
        ]
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/messages") {
      await proxyMessages(req, res);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: String(error && error.stack ? error.stack : error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DeepSeek Anthropic gateway listening on http://${HOST}:${PORT}`);
  console.log("Model mapping (official DeepSeek rules):");
  console.log(`  claude-opus*   -> ${DEEPSEEK_PRO}`);
  console.log(`  claude-sonnet* -> ${DEEPSEEK_FLASH}`);
  console.log(`  claude-haiku*  -> ${DEEPSEEK_FLASH}`);
  console.log(`  other claude*  -> ${DEEPSEEK_FLASH}`);
});
