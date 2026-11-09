const http = require("http");

const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";
const UPSTREAM = "https://api.deepseek.com/anthropic";
const TARGET_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4.1-pro";
const API_KEY = process.env.DEEPSEEK_API_KEY;

// Updated mappings pointing to latest DeepSeek V4.1 Flash and Pro releases
const MODEL_MAP = {
  // Pro models
  "claude-3-7-sonnet-20250219": "deepseek-v4.1-pro",
  "claude-3-5-sonnet-20241022": "deepseek-v4.1-pro",
  "claude-3-5-sonnet-20240620": "deepseek-v4.1-pro",
  "claude-3-opus-20240229": "deepseek-v4.1-pro",
  "claude-sonnet-4-5": "deepseek-v4.1-pro",
  "claude-opus-4-5": "deepseek-v4.1-pro",

  // Flash models
  "claude-3-5-haiku-20241022": "deepseek-v4.1-flash",
  "claude-haiku-4-5": "deepseek-v4.1-flash"
};

if (!API_KEY) {
  console.error("Missing DEEPSEEK_API_KEY. Set it before starting this gateway.");
  process.exit(1);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      raw += chunk;
    });
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

      const {
        thinking,
        signature,
        redacted_thinking,
        ...cleanedBlock
      } = block;

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

    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    const {
      thinking,
      signature,
      ...cleanedMessage
    } = message;

    messages.push({
      ...cleanedMessage,
      content: cleanContent(message.content)
    });
  }

  const requestedModel = body.model || "unknown";
  const mappedModel = process.env.DEEPSEEK_MODEL || MODEL_MAP[requestedModel] || TARGET_MODEL;

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

  // Log exact model breakdown to console for every incoming call
  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}] HTTP ${upstreamRes.status} | Client Requested: "${requestedModel}" | DeepSeek Model Used: "${mappedModel}"`
  );

  const headers = {
    "content-type": upstreamRes.headers.get("content-type") || "application/json; charset=utf-8",
    // Attach custom headers so client/proxy inspectors can verify exact model used
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
            id: "claude-3-7-sonnet-20250219",
            type: "model",
            display_name: "DeepSeek V4.1 Pro"
          },
          {
            id: "claude-3-5-sonnet-20241022",
            type: "model",
            display_name: "DeepSeek V4.1 Pro"
          },
          {
            id: "claude-3-5-haiku-20241022",
            type: "model",
            display_name: "DeepSeek V4.1 Flash"
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
  console.log("Model mapping:");
  for (const [from, to] of Object.entries(MODEL_MAP)) {
    console.log(`  ${from} -> ${process.env.DEEPSEEK_MODEL || to}`);
  }
});