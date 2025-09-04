// --- START main.ts for Deno ---
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

// 从环境变量读取
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const PORT = parseInt(Deno.env.get("PORT") ?? "3000");

// OpenRouter 生成接口
async function handleGenerate(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { prompt = "", images = [], apikey = "" } = body;

    const apiKey = OPENROUTER_API_KEY || apikey;
    if (!apiKey) {
      return Response.json({ error: "Missing OpenRouter API key" });
    }

    const imgContents = Array.isArray(images)
      ? images
        .filter((s: unknown) => typeof s === "string" && s.startsWith("data:image/"))
        .map((dataUrl: string) => ({
          type: "image_url",
          image_url: { url: dataUrl },
        }))
      : [];

    const payload = {
      model: "google/gemini-2.5-flash-image-preview:free",
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: String(prompt) }, ...imgContents],
        },
      ],
    };

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:" + PORT,
        "X-Title": "nano-banana",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      const msg = data?.error?.message || data?.message || JSON.stringify(data);
      return Response.json({ error: msg });
    }

    const msg = data?.choices?.[0]?.message;
    const imageDataUrl = msg?.images?.[0]?.image_url?.url;

    if (typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:image/")) {
      return Response.json({ imageUrl: imageDataUrl });
    }

    return Response.json({
      retry: true,
      message: msg?.content || "Model returned no image",
    });
  } catch (err) {
    return Response.json({ error: String(err) });
  }
}

// 路由分发
function handler(req: Request): Promise<Response> | Response {
  const url = new URL(req.url);

  if (url.pathname === "/api/key-status") {
    return Response.json({ isSet: Boolean(OPENROUTER_API_KEY) });
  }
  if (url.pathname === "/generate" && req.method === "POST") {
    return handleGenerate(req);
  }

  // 兜底：返回 static/ 目录的文件（index.html, script.js, style.css, bao.jpg）
  return serveDir(req, {
    fsRoot: "static",
    urlRoot: "",
    showDirListing: false,
    enableCors: true,
  });
}

// 启动服务
console.log(`Deno server running at http://localhost:${PORT}`);
serve(handler, { port: PORT });
// --- END main.ts ---
