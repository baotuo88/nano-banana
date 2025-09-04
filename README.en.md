# 🍌 Nanobanana - Gemini API Proxy & Multimodal Web UI

[中文](./README.md)

A powerful dual-purpose service: it acts as both a **Google Gemini API-compatible proxy for OpenRouter** and provides an intuitive **Web User Interface** for easy interaction with multimodal models for text-to-image and image-to-text generation.

---

### 🎥 Quick Demo

[![Watch on Douyin](https://img.shields.io/badge/Watch_Demo_Video-Click_Here-161823?style=for-the-badge&logo=douyin)](https://www.douyin.com/video/7545761080266460456)

Click the badge above to watch a live demonstration of the project's features.

---

## ✨ Core Features

### 🚀 API Proxy (for Developers)

*   **Gemini API Compatibility**: Provides API endpoints fully compatible with the Google AI JS SDK (`@google/generative-ai`). Seamlessly redirect your existing Gemini client code to this service and leverage any model supported by OpenRouter.
*   **Streaming & Non-Streaming Support**: Fully implements both `:streamGenerateContent` (streaming) and `:generateContent` (non-streaming) core endpoints.
*   **Smart Context Extraction**: The proxy automatically extracts the most recent and relevant context from the full conversation history (`contents`), optimizing request efficiency.
*   **Unified Authentication**: Supports passing the OpenRouter API Key via `Authorization: Bearer <API_KEY>` or `x-goog-api-key` headers.

### 🎨 Web UI (for Users)

*   **Multi-Image Upload**: Supports drag-and-drop or click-to-upload for one or more images with real-time thumbnail previews.
*   **Intuitive Interaction**: Combine uploaded images with text prompts to chat or create with the AI.
*   **Smart API Key Handling**:
    *   If the `OPENROUTER_API_KEY` environment variable is set during deployment, the frontend automatically hides the input field for a clean user experience.
    *   If the environment variable is not set, the input field is displayed for temporary key entry.
*   **Instant Results**: Directly displays the generated text or image results on the right side of the interface.

---

## 🚀 Deploy to Deno Deploy

**Manual Steps:**

1.  **Fork this Project**: Fork this repository to your own GitHub account.
2.  **Log in to Deno Deploy**: Use your GitHub account to log in to the [Deno Deploy Dashboard](https://dash.deno.com/projects).
3.  **Create a New Project**:
    *   Click "New Project".
    *   Select the GitHub repository you just forked.
    *   Choose the `main` branch and select `main.ts` as the entry point file.
4.  **(Optional but Recommended) Add Environment Variable**:
    *   In your project's "Settings" -> "Environment Variables", add a new variable named `OPENROUTER_API_KEY`.
    *   Set its value to your own OpenRouter API key. This will allow you to use the Web UI without repeatedly entering your key.
5.  **Deploy**: Click the "Link" or "Deploy" button, and Deno Deploy will automatically deploy your application.

---

## 🛠️ How to Use

### Method 1: Using the Web Interface

1.  Open your deployed `*.deno.dev` URL.
2.  If you did **not** set the environment variable during deployment, enter your OpenRouter API Key in the input box under the "Settings" section.
3.  Upload one or more images.
4.  Enter your prompt in the text area (e.g., "Make this cat look like an astronaut").
5.  Click the "Generate" button and view the result on the right.

### Method 2: As an API Proxy (for Developers)

Simply point your existing Gemini client's API base path to your Deno Deploy URL.

**cURL Example**:
Assuming your deployment URL is `https://nanobanana.deno.dev`.

```bash
curl -X POST https://nanobanana.deno.dev/v1beta/models/gemini-pro:generateContent \
-H "Content-Type: application/json" \
-H "Authorization: Bearer YOUR_OPENROUTER_API_KEY" \
-d '{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "What is in this picture?" },
        {
          "inlineData": {
            "mimeType": "image/jpeg",
            "data": "YOUR_BASE64_ENCODED_IMAGE"
          }
        }
      ]
    }
  ]
}'
```

---

## 📡 API Endpoints

| Endpoint                                           | Method | Purpose                                     | Notes                                        |
| -------------------------------------------------- | ------ | ------------------------------------------- | -------------------------------------------- |
| `/v1beta/models/gemini-pro:streamGenerateContent`  | `POST` | Streaming content generation (Gemini SDK)   | Responds with a Server-Sent Events (SSE) stream. |
| `/v1beta/models/gemini-pro:generateContent`        | `POST` | Non-streaming content generation (Gemini SDK) | Responds with a standard JSON object.      |
| `/generate`                                        | `POST` | Backend for the Nanobanana Web UI.          | For internal use.                            |
| `/api/key-status`                                  | `GET`  | Checks if API Key is set in env vars.       | Used by the Web UI to toggle the input field.  |

---

## 💻 Tech Stack

-   **Frontend**: Native HTML, CSS, JavaScript (No frameworks)
-   **Backend**: Deno, Deno Standard Library
-   **AI Models**: Proxied via [OpenRouter](https://openrouter.ai/), defaults to `google/gemini-2.5-flash-image-preview:free`

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
