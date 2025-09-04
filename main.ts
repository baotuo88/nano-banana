// --- START main.ts (Deno, 402-safe) ---
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

const PORT = parseInt(Deno.env.get("PORT") ?? "3000", 10);
let OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") ?? ""; // 可选：用于 /api/set-key

// ===== 工具函数 =====
function okJson(obj: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function extractImageDataUrl(data: unknown): string | null {
  try {
    const msg = (data as any)?.choices?.[0]?.message;
    // 1) 标准位置（OpenRouter 常见结构）
    const url = msg?.images?.[0]?.image_url?.url;
    if (typeof url === "string" && url.startsWith("data:image/")) return url;
    // 2) 某些提供方把 dataURL 放在 content 文本里
    const content: string | undefined =
      typeof msg?.content === "string" ? msg.content : undefined;
    if (content) {
      const m = content.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
      if (m) return m[0];
    }
  } catch {
    // ignore
  }
  return null;
}

async function callOpenRouterJSON(payload: any, apiKey: string) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": `http://localhost:${PORT}`,
    "X-Title": "nano-banana",
  };

  // 轻量重试：429 或 5xx 做指数退避
  const backoffs = [500, 1000, 2000];
  let lastErr = "";
  for (let i = 0; i < backoffs.length; i++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const text = await resp.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch { /* 不是 JSON 时原样回显片段 */ }

      if (!resp.ok) {
        // 可重试的状态码
        if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
          lastErr = `HTTP ${resp.status} ${resp.statusText} | ${text.slice(0, 300)}`;
          await new Promise(r => setTimeout(r, backoffs[i]));
          continue;
        }
        return { ok: false, status: resp.status, statusText: resp.statusText, data, raw: text };
      }
      return { ok: true, status: resp.status, data, raw: text };
    } catch (e) {
      lastErr = String(e);
      await new Promise(r => setTimeout(r, backoffs[i]));
    }
  }
  return { ok: false, status: 0, statusText: "network/retry-failed", data: null, raw: lastErr };
}

// ===== 业务处理 =====
async function handleGenerate(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const {
      prompt = "",
      images = [],
      apikey = "",
      count = 1,
      model,
      max_tokens, // 允许前端自定义，否则采用默认
    } = body ?? {};

    const apiKey = (OPENROUTER_API_KEY || apikey || "").trim();
    if (!apiKey) return okJson({ error: "Missing OpenRouter API key" }, { status: 400 });

    // 组装图片内容
    const imgContents = Array.isArray(images)
      ? images
          .filter((s: unknown) => typeof s === "string" && s.startsWith("data:image/"))
          .map((dataUrl: string) => ({ type: "image_url", image_url: { url: dataUrl } }))
      : [];

    // 使用你绑定集成的 Gemini，建议不带 :free
    const mdl = (typeof model === "string" && model.trim())
      ? model.trim()
      : "google/gemini-2.5-flash-image-preview";

    // 截断超长 prompt，进一步降低花费
    const p = String(prompt ?? "");
    const MAX_PROMPT_CHARS = 2000;
    const safePrompt = p.length > MAX_PROMPT_CHARS ? (p.slice(0, MAX_PROMPT_CHARS) + " …") : p;

    // 限制生成长度，避免 402；可通过 body.max_tokens 覆盖
    const MAX_TOKENS = Number.isFinite(max_tokens) ? Math.max(1, Math.min(8192, Number(max_tokens))) : 1024;

    const basePayload = {
      model: mdl,
      modalities: ["image", "text"],
      max_tokens: MAX_TOKENS, // ★ 关键：控制开销，避免 402
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: safePrompt }, ...imgContents],
        },
      ],
    };

    const n = Math.min(Math.max(parseInt(String(count || 1), 10), 1), 4);
    const results: string[] = [];

    for (let i = 0; i < n; i++) {
      // 第一次尝试
      let result = await callOpenRouterJSON(basePayload, apiKey);

      // 402 兜底：自动降级一次到 :free（可能撞免费池子，但能救急）
      if (!result.ok && result.status === 402) {
        const fbPayload = { ...basePayload, model: `${mdl}:free` };
        const fb = await callOpenRouterJSON(fbPayload, apiKey);
        if (fb.ok) result = fb; // 用降级结果覆盖
      }

      if (!result.ok) {
        return okJson({
          error: "Provider returned error",
          detail: { status: result.status, statusText: result.statusText, snippet: String(result.raw ?? "").slice(0, 300) }
        }, { status: result.status || 502 });
      }

      const imageDataUrl = extractImageDataUrl(result.data);
      if (!imageDataUrl) {
        // 返回软失败，让前端决定是否重试
        const msgContent = (result.data as any)?.choices?.[0]?.message?.content;
        return okJson({ retry: true, message: msgContent || "Model returned no image in response" });
      }
      results.push(imageDataUrl);
    }

    return okJson({ images: results });
  } catch (err) {
    return okJson({ error: String(err) }, { status: 500 });
  }
}

// ===== 路由分发 =====
function handler(req: Request): Promise<Response> | Response {
  const url = new URL(req.url);

  // Key 状态（用于前端隐藏输入框）
  if (url.pathname === "/api/key-status") {
    return okJson({ isSet: Boolean(OPENROUTER_API_KEY) });
  }

  // 动态更新 Key（可选）：需要设置 ADMIN_TOKEN，并在请求头传 x-admin-token
  if (url.pathname === "/api/set-key" && req.method === "POST") {
    if (!ADMIN_TOKEN) return okJson({ error: "Admin disabled" });
    const token = req.headers.get("x-admin-token");
    if (token !== ADMIN_TOKEN) return okJson({ error: "Unauthorized" }, { status: 401 });
    return req.json().then((b: any) => {
      const key = (b?.key || "").trim();
      if (!key) return okJson({ error: "Missing key" }, { status: 400 });
      OPENROUTER_API_KEY = key;
      return okJson({ ok: true });
    });
  }

  // 生成
  if (url.pathname === "/generate" && req.method === "POST") {
    return handleGenerate(req);
  }

  // 反馈（简单内存收集；你可接入持久化）
  if (url.pathname === "/feedback" && req.method === "POST") {
    return req.json().then((b: any) => {
      const text = String(b?.text || "").trim();
      if (!text) return okJson({ error: "Empty" }, { status: 400 });
      console.log(new Date().toISOString(), "FEEDBACK", text.slice(0, 500));
      return okJson({ ok: true });
    });
  }

  // 静态资源：static/ 目录
  return serveDir(req, {
    fsRoot: "static",
    urlRoot: "",
    showDirListing: false,
    enableCors: true,
  });
}

console.log(`Deno server running at http://localhost:${PORT}`);
serve(handler, { port: PORT });
// --- END main.ts ---
