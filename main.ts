// --- START main.ts (Deno, enhanced) ---
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const PORT = parseInt(Deno.env.get("PORT") ?? "3000", 10);

// 你可以改成不带 :free 的版本，以使用你在 OpenRouter 绑定的 Google Key
const DEFAULT_MODEL = "google/gemini-2.5-flash-image-preview"; // ← 推荐用这个
// const DEFAULT_MODEL = "google/gemini-2.5-flash-image-preview:free"; // 若仍想走 free（不推荐）

function extractImageDataUrl(data: unknown): string | null {
  try {
    const msg = (data as any)?.choices?.[0]?.message;
    // 1) 标准位置
    const imageUrl = msg?.images?.[0]?.image_url?.url;
    if (typeof imageUrl === "string" && imageUrl.startsWith("data:image/")) {
      return imageUrl;
    }
    // 2) 兜底：有些提供方把 dataURL 混在 content 文本里
    const content: string | undefined = typeof msg?.content === "string" ? msg.content : undefined;
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

  // 简单的服务端重试：仅对 429/5xx/网络错误做 3 次指数退避
  const backoffs = [500, 1000, 2000];
  let lastErr: string | null = null;
  for (let i = 0; i < backoffs.length; i++) {
    try {
      const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      const text = await resp.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch { /* 不是 JSON 也原样回显片段 */ }

      if (!resp.ok) {
        // 429/5xx 进入重试；其它状态直接返回
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
  return { ok: false, status: 0, statusText: "network/retry-failed", data: null, raw: lastErr ?? "unknown" };
}

async function handleGenerate(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { prompt = "", images = [], apikey = "", model } = body ?? {};

    const apiKey = (OPENROUTER_API_KEY || apikey || "").trim();
    if (!apiKey) {
      return Response.json({ error: "Missing OpenRouter API key" });
    }

    const imgContents = Array.isArray(images)
      ? images
          .filter((s: unknown) => typeof s === "string" && s.startsWith("data:image/"))
          .map((dataUrl: string) => ({ type: "image_url", image_url: { url: dataUrl } }))
      : [];

    const payload = {
      model: typeof model === "string" && model.trim() ? model : DEFAULT_MODEL,
      modalities: ["image", "text"],
      messages: [
        { role: "user", content: [{ type: "text", text: String(prompt) }, ...imgContents] },
      ],
    };

    const result = await callOpenRouterJSON(payload, apiKey);

    // 硬错误：直接把关键信息回显到前端，便于定位
    if (!result.ok) {
      const snippet = typeof result.raw === "string" ? result.raw.slice(0, 300) : "";
      return Response.json({
        error: `Provider returned error`,
        detail: {
          status: result.status,
          statusText: result.statusText,
          snippet,
        },
      });
    }

    // 成功：尝试按多种方式提取图片
    const imageDataUrl = extractImageDataUrl(result.data);
    if (imageDataUrl) {
      return Response.json({ imageUrl: imageDataUrl });
    }

    // 没有图片：软失败（前端会做重试）
    const msgContent = (result.data as any)?.choices?.[0]?.message?.content;
    return Response.json({
      retry: true,
      message: msgContent || "Model returned no image in response",
    });
  } catch (err) {
    return Response.json({ error: String(err) });
  }
}

function handler(req: Request): Promise<Response> | Response {
  const url = new URL(req.url);

  if (url.pathname === "/api/key-status") {
    return Response.json({ isSet: Boolean(OPENROUTER_API_KEY) });
  }
  if (url.pathname === "/generate" && req.method === "POST") {
    return handleGenerate(req);
  }

  // 静态资源目录
  return serveDir(req, { fsRoot: "static", urlRoot: "", showDirListing: false, enableCors: true });
}

console.log(`Deno server running at http://localhost:${PORT}`);
serve(handler, { port: PORT });
// --- END main.ts ---
