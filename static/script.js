// --- START OF FILE script.js ---

document.addEventListener('DOMContentLoaded', async () => {
  const uploadArea = document.querySelector('.upload-area');
  const fileInput = document.getElementById('image-upload');
  const thumbnailsContainer = document.getElementById('thumbnails-container');
  const promptInput = document.getElementById('prompt-input');
  const apiKeyInput = document.getElementById('api-key-input');
  const generateBtn = document.getElementById('generate-btn');
  const btnText = generateBtn.querySelector('.btn-text');
  const spinner = generateBtn.querySelector('.spinner');
  const resultContainer = document.getElementById('result-image-container');
  const apiKeySection = document.querySelector('.api-key-section');

  // 让整块上传区域可点击
  uploadArea.addEventListener('click', (e) => {
    // 避免点在移除按钮时触发
    if (!(e.target instanceof HTMLButtonElement)) fileInput.click();
  });

  let selectedFiles = []; // {file, key}，key 为判重指纹

  // 检查服务端是否已配置 API Key（是则隐藏输入框）
  try {
    const response = await fetch('/api/key-status');
    if (response.ok) {
      const data = await response.json();
      if (data.isSet) apiKeySection.style.display = 'none';
    }
  } catch (error) {
    console.error("无法检查 API key 状态:", error);
  }

  // 拖放与选择
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev =>
    uploadArea.addEventListener(ev, preventDefaults, false)
  );
  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
  ['dragenter', 'dragover'].forEach(ev => {
    uploadArea.addEventListener(ev, () => uploadArea.classList.add('drag-over'));
  });
  ['dragleave', 'drop'].forEach(ev => {
    uploadArea.addEventListener(ev, () => uploadArea.classList.remove('drag-over'));
  });
  uploadArea.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    handleFiles(files);
  });
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    handleFiles(files);
  });

  function buildFingerprint(file) {
    return `${file.name}__${file.size}__${file.lastModified}`;
  }

  function handleFiles(files) {
    files.forEach(file => {
      const key = buildFingerprint(file);
      if (!selectedFiles.some(it => it.key === key)) {
        selectedFiles.push({ file, key });
        createThumbnail(file, key);
      }
    });
  }

  function createThumbnail(file, key) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'thumbnail-wrapper';
      const img = document.createElement('img');
      img.src = e.target.result;
      img.alt = file.name;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.setAttribute('aria-label', '移除图片');
      removeBtn.textContent = '×';
      removeBtn.onclick = (ev) => {
        ev.stopPropagation();
        selectedFiles = selectedFiles.filter(it => it.key !== key);
        wrapper.remove();
      };

      wrapper.appendChild(img);
      wrapper.appendChild(removeBtn);
      thumbnailsContainer.appendChild(wrapper);
    };
    reader.readAsDataURL(file);
  }

  generateBtn.addEventListener('click', async () => {
    if (apiKeySection.style.display !== 'none' && !apiKeyInput.value.trim()) {
      alert('请输入 OpenRouter API 密钥');
      return;
    }
    if (selectedFiles.length === 0) {
      alert('请选择至少一张图片');
      return;
    }
    if (!promptInput.value.trim()) {
      alert('请输入提示词');
      return;
    }

    setLoading(true);
    safeSetResultStatus('正在请求模型...');

    const backoffs = [1000, 2000, 4000]; // 指数退避
    let lastMessage = '未知错误';

    try {
      const base64Images = await Promise.all(
        selectedFiles.map(({ file }) => fileToBase64(file))
      );

      for (let i = 0; i < backoffs.length; i++) {
        const attempt = i + 1;
        try {
          if (attempt > 1) {
            safeSetResultStatus(`仅收到文本，准备重试... (${attempt}/${backoffs.length})`);
            await delay(backoffs[i]);
          }

          const resp = await fetch('/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: promptInput.value,
              images: base64Images,
              apikey: apiKeyInput.value
            })
          });

          const data = await resp.json();

          if (data?.error) {
            throw new Error(data.error);
          }

          if (data?.imageUrl && isSafeImageUrl(data.imageUrl)) {
            displayResultImage(data.imageUrl);
            return; // 成功结束
          }

          if (data?.retry) {
            lastMessage = String(data.message || '模型返回了文本而非图片');
            // 继续下一次循环
          } else {
            throw new Error('未知的服务器响应');
          }
        } catch (err) {
          lastMessage = err?.message || String(err);
          // 若还有重试次数则继续
          if (attempt === backoffs.length) {
            throw new Error(lastMessage);
          }
        }
      }

      throw new Error(`重试后仍失败：${lastMessage}`);
    } catch (error) {
      safeSetResultStatus(`生成失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  });

  function setLoading(isLoading) {
    generateBtn.disabled = isLoading;
    btnText.textContent = isLoading ? '正在生成...' : '生成';
    spinner.classList.toggle('hidden', !isLoading);
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 安全设置状态文本（避免 XSS）
  function safeSetResultStatus(text) {
    resultContainer.replaceChildren();
    const p = document.createElement('p');
    p.textContent = text;
    resultContainer.appendChild(p);
  }

  // 仅允许 data URL 或同源/https 图片
  function isSafeImageUrl(url) {
    try {
      if (url.startsWith('data:image/')) return true;
      const u = new URL(url, window.location.origin);
      return ['https:', 'http:'].includes(u.protocol) && u.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function displayResultImage(imageUrl) {
    resultContainer.replaceChildren();
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = '生成的图片';
    resultContainer.appendChild(img);
  }
});

// --- END OF FILE script.js ---
