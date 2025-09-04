// --- START main.ts (Deno, features+) ---
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

const PORT = parseInt(Deno.env.get("PORT") ?? "3000", 10);
let OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") ?? ""; // 可选：用于 /api/set-key

// 简易内存存储
const feedbacks: Array<{ ts: number; text: string; ip?: string }> = [];
const shares = new Map<string, string>(); // id -> dataUrl

// 限流（分钟 & 日）
const perMin = new Map<string, { count: number; reset: number }>();
const perDay = new Map<string, { count: number; reset: number }>();
const LIMIT_PER_MIN = 20;
const LIMIT_PER_DAY = 400;

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      || req.headers.get("cf-connecting-ip")
      || req.headers.get("x-real-ip")
      || "0.0.0.0";
}
function checkRateLimit(ip: string): string | null {
  const now = Date.now();
  // minute
  const m = perMin.get(ip) ?? { count: 0, reset: now + 60_000 };
  if (now > m.reset) { m.count = 0; m.reset = now + 60_000; }
  m.count++; perMin.set(ip, m);
  if (m.count > LIMIT_PER_MIN) return `Too many requests per minute`;

  // day
  const d = perDay.get(ip) ?? { count: 0, reset: now + 24*60*60*1000 };
  if (now > d.reset) { d.count = 0; d.reset = now + 24*60*60*1000; }
  d.count++; perDay.set(ip, d);
  if (d.count > LIMIT_PER_DAY) return `Daily limit reached`;

  return null;
}

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), ...args);
  // 如需写文件：deno run 添加 --allow-write，然后：
  // await Deno.writeTextFile("server.log", `${new Date().toISOString()} ${args.map(String).join(" ")}\n`, {append:true});
}

function extractImageDataUrl(data: unknown): string | null {
  try {
    const msg = (data as any)?.choices?.[0]?.message;
    const imageUrl = msg?.images?.[0]?.image_url?.url;
    if (typeof imageUrl === "string" && imageUrl.startsWith("data:image/")) return imageUrl;
    const content: string | undefined = typeof msg?.content === "string" ? msg.content : undefined;
    if (content) {
      const m = content.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
      if (m) return m[0];
    }
  } catch {}
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
  const backoffs = [500, 1000, 2000];
  let lastErr: string | null = null;
  for (let i = 0; i < backoffs.length; i++) {
    try {
      const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      const text = await resp.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch {}
      if (!resp.ok) {
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
  const ip = clientIp(req);
  const limited = checkRateLimit(ip);
  if (limited) return Response.json({ error: limited }, { status: 429 });

  try {
    const body = await req.json();
    const { prompt = "", images = [], apikey = "", count = 1, model } = body ?? {};
    const apiKey = (OPENROUTER_API_KEY || apikey || "").trim();
    if (!apiKey) return Response.json({ error: "Missing OpenRouter API key" }, { status: 400 });

    const imgContents = Array.isArray(images)
      ? images.filter((s: unknown) => typeof s === "string" && s.startsWith("data:image/"))
              .map((dataUrl: string) => ({ type: "image_url", image_url: { url: dataUrl } }))
      : [];

    const mdl = (typeof model === "string" && model.trim())
      ? model.trim()
      : "google/gemini-2.5-flash-image-preview"; // 建议绑定你自己的 Google Key 后使用不带 :free

    const basePayload = {
      model: mdl,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: [{ type: "text", text: String(prompt) }, ...imgContents] }],
    };

    const n = Math.min(Math.max(parseInt(String(count||1),10),1),4);
    const results: string[] = [];
    for (let i = 0; i < n; i++) {
      const result = await callOpenRouterJSON(basePayload, apiKey);
      if (!result.ok) {
        log("generate-error", { ip, prompt, status: result.status, detail: result.raw?.toString().slice(0,300) });
        // 对单次失败：直接返回错误给前端（也可选择收集部分成功图像继续返回）
        return Response.json({
          error: "Provider returned error",
          detail: { status: result.status, statusText: result.statusText, snippet: String(result.raw ?? '').slice(0,300) }
        }, { status: 502 });
      }
      const imageDataUrl = extractImageDataUrl(result.data);
      if (!imageDataUrl) {
        log("no-image-in-response", { ip, prompt });
        return Response.json({ retry: true, message: "Model returned no image in response" });
      }
      results.push(imageDataUrl);
    }

    log("generate-ok", { ip, prompt, count: results.length });
    return Response.json({ images: results });
  } catch (err) {
    log("generate-exception", { ip, err: String(err) });
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

function okJson(obj: unknown) { return new Response(JSON.stringify(obj), { headers: { "content-type":"application/json" } }); }

function handler(req: Request): Promise<Response> | Response {
  const url = new URL(req.url);
  const ip = clientIp(req);

  // Key 状态/管理
  if (url.pathname === "/api/key-status") {
    return okJson({ isSet: Boolean(OPENROUTER_API_KEY) });
  }
  if (url.pathname === "/api/set-key" && req.method === "POST") {
    if (!ADMIN_TOKEN) return okJson({ error: "Admin disabled" });
    const token = req.headers.get("x-admin-token");
    if (token !== ADMIN_TOKEN) return okJson({ error: "Unauthorized" });
    return req.json().then((b: any) => {
      const key = (b?.key || "").trim();
      if (!key) return okJson({ error: "Missing key" });
      OPENROUTER_API_KEY = key;
      log("key-updated", { ip });
      return okJson({ ok: true });
    });
  }

  // 生成
  if (url.pathname === "/generate" && req.method === "POST") {
    return handleGenerate(req);
  }

  // 反馈
  if (url.pathname === "/feedback" && req.method === "POST") {
    return req.json().then((b: any) => {
      const text = String(b?.text || "").trim();
      if (!text) return okJson({ error: "Empty" });
      feedbacks.push({ ts: Date.now(), text, ip });
      log("feedback", { ip, len: text.length });
      return okJson({ ok: true });
    });
  }

  // 分享：上传 DataURL → 返回 id
  if (url.pathname === "/share" && req.method === "POST") {
    return req.json().then((b: any) => {
      const dataUrl = String(b?.dataUrl || "");
      if (!dataUrl.startsWith("data:image/")) return okJson({ error: "Invalid image" });
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      shares.set(id, dataUrl);
      return okJson({ id, url: `/s/${id}` });
    });
  }
  // 分享展示
  if (url.pathname.startsWith("/s/")) {
    const id = url.pathname.split("/").pop()!;
    const dataUrl = shares.get(id);
    if (!dataUrl) return new Response("Not found", { status: 404 });
    const html = `<!doctype html><meta charset="utf-8"/>
      <title>nano banana share</title>
      <style>body{background:#121212;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh}img{max-width:90vw;max-height:90vh;border-radius:12px}</style>
      <img src="${dataUrl}" alt="shared image"/>`;
    return new Response(html, { headers: { "content-type":"text/html" } });
  }

  // 静态资源
  return serveDir(req, { fsRoot: "static", urlRoot: "", showDirListing: false, enableCors: true });
}

console.log(`Deno server running at http://localhost:${PORT}`);
serve(handler, { port: PORT });
// --- END main.ts ---
