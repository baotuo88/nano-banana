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
  const tplBtns = document.querySelectorAll('.tpl-btn');
  const countInput = document.getElementById('count-input');
  const sizeInput = document.getElementById('size-input');
  const styleInput = document.getElementById('style-input');
  const historyContainer = document.getElementById('history-container');
  const feedbackBtn = document.getElementById('feedback-btn');
  const feedbackDialog = document.getElementById('feedback-dialog');
  const feedbackSubmit = document.getElementById('feedback-submit');
  const feedbackText = document.getElementById('feedback-text');

  // 让整块上传区域可点击
  uploadArea.addEventListener('click', (e) => {
    if (!(e.target instanceof HTMLButtonElement)) fileInput.click();
  });

  let selectedFiles = []; // {file, key}

  // Key 状态（有服务端 Key 就隐藏输入框）
  try {
    const response = await fetch('/api/key-status');
    if (response.ok) {
      const data = await response.json();
      if (data.isSet) apiKeySection.style.display = 'none';
    }
  } catch (e) { console.warn('key-status 查询失败', e); }

  // 历史初始化
  loadHistory();

  // 拖放与选择
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev =>
    uploadArea.addEventListener(ev, preventDefaults, false)
  );
  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
  ['dragenter', 'dragover'].forEach(ev => uploadArea.addEventListener(ev, () => uploadArea.classList.add('drag-over')));
  ['dragleave', 'drop'].forEach(ev => uploadArea.addEventListener(ev, () => uploadArea.classList.remove('drag-over')));

  uploadArea.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    handleFiles(files);
  });
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    handleFiles(files);
    // 关键：重置 value，重复选择同一张图也会触发 change
    e.target.value = '';
  });

  function buildFingerprint(file) { return `${file.name}__${file.size}__${file.lastModified}`; }
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

  // 模板注入
  tplBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = btn.dataset.tpl || '';
      const origin = promptInput.value.trim();
      promptInput.value = origin ? `${origin}\n${tpl}` : tpl;
    });
  });

  // 生成逻辑（多图）
  generateBtn.addEventListener('click', async () => {
    const needKey = (apiKeySection.style.display !== 'none');
    if (needKey && !apiKeyInput.value.trim()) {
      alert('请输入 OpenRouter API 密钥');
      return;
    }
    if (!promptInput.value.trim()) {
      alert('请输入提示词');
      return;
    }
    const count = Math.min(Math.max(parseInt(countInput.value || '1', 10), 1), 4);

    setLoading(true);
    safeSetResultStatus('正在生成...');

    try {
      // 压缩后再上传，显著提高成功率
      const base64Images = await Promise.all(
        selectedFiles.map(({ file }) => fileToCompressedDataURL(file, 1280, 1280, 0.9))
      );

      // 粗略计算总大小，>10MB 直接提示
      const totalBytes = base64Images.reduce((acc, s) => acc + (s?.length || 0), 0);
      if (totalBytes > 10 * 1024 * 1024) {
        alert('图片总大小过大（>10MB），请减少张数或使用更小的图。');
        setLoading(false);
        return;
      }

      const payload = {
        prompt: decoratePrompt(promptInput.value, sizeInput.value, styleInput.value),
        images: base64Images,          // 作为参考图/编辑图
        apikey: apiKeyInput.value,
        count,                         // 服务端循环生成
      };

      const resp = await fetch('/generate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await resp.json();

      if (data?.error) {
        safeSetResultStatus(`生成失败：${data.error}${data?.detail ? ` | ${JSON.stringify(data.detail)}` : ''}`);
        return;
      }

      const images = Array.isArray(data?.images) ? data.images : (data?.imageUrl ? [data.imageUrl] : []);
      if (images.length === 0 && data?.retry) {
        safeSetResultStatus(`仅收到文本，稍后再试：${data.message || ''}`);
        return;
      }

      // 展示与历史
      showImages(images);
      appendHistory(images, payload.prompt);

    } catch (e) {
      safeSetResultStatus(`生成失败：${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  });

  function decoratePrompt(p, size, style) {
    const extras = [];
    if (style) extras.push(`风格：${style}`);
    if (size === 'portrait') extras.push(`画幅：竖版`);
    if (size === 'landscape') extras.push(`画幅：横版`);
    if (size === 'square') extras.push(`画幅：正方形`);
    // 强化“只返回图片”倾向（可按需移除）
    extras.push('只返回生成的图像，不要任何文字描述。');
    return extras.length ? `${p}\n${extras.join('，')}` : p;
  }

  // 展示多图 + 操作位（下载/分享/二次生成），使用类名以匹配美化后的 CSS
  function showImages(urls) {
    resultContainer.replaceChildren();

    const grid = document.createElement('div');
    grid.className = 'nb-grid';

    urls.forEach(u => {
      const card = document.createElement('div');
      card.className = 'nb-card-img';

      const img = document.createElement('img');
      img.src = u;
      img.alt = '生成的图片';

      const bar = document.createElement('div');
      bar.className = 'nb-toolbar';

      const btnDL = mkBtn('下载', () => downloadDataUrl(u, `nano_${Date.now()}.png`));
      const btnShare = mkBtn('分享', async () => {
        try {
          if (navigator.share && navigator.canShare) {
            const file = await dataURLtoFile(u, 'image.png');
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: 'nano banana' });
            } else {
              await navigator.clipboard.writeText(u);
              alert('已复制图片 DataURL，可自行分享');
            }
          } else {
            await navigator.clipboard.writeText(u);
            alert('已复制图片 DataURL，可自行分享');
          }
        } catch (e) { alert('分享失败：' + (e?.message || e)); }
      });
      const btnRegen = mkBtn('基于此图再生成', async () => {
        // 把这张图当作输入图再次生成
        selectedFiles = []; thumbnailsContainer.innerHTML = '';
        const f = await dataURLtoFile(u, `ref_${Date.now()}.png`);
        handleFiles([f]);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      bar.append(btnDL, btnShare, btnRegen);
      card.append(img, bar);
      grid.append(card);
    });

    resultContainer.appendChild(grid);
  }

  function mkBtn(text, onClick) {
    const b = document.createElement('button');
    b.textContent = text;
    b.className = 'nb-btn'; // 使用统一按钮样式
    b.addEventListener('click', onClick);
    return b;
  }

  // 历史记录（localStorage）
  function appendHistory(urls, prompt) {
    const key = 'nb_history';
    const old = JSON.parse(localStorage.getItem(key) || '[]');
    const item = { ts: Date.now(), prompt, urls };
    const next = [item, ...old].slice(0, 60); // 最多保存 60 组
    localStorage.setItem(key, JSON.stringify(next));
    renderHistory(next);
  }
  function loadHistory() {
    const arr = JSON.parse(localStorage.getItem('nb_history') || '[]');
    renderHistory(arr);
  }
  function renderHistory(arr) {
    historyContainer.replaceChildren();
    arr.forEach(entry => {
      entry.urls.forEach(u => {
        const img = document.createElement('img');
        img.src = u; img.alt = '历史图';
        img.style.width = '100%'; img.style.borderRadius = '10px';
        img.title = new Date(entry.ts).toLocaleString();
        img.addEventListener('click', () => {
          showImages([u]);
        });
        historyContainer.appendChild(img);
      });
    });
  }

  // 反馈
  feedbackBtn.addEventListener('click', () => {
    feedbackText.value = '';
    if (typeof feedbackDialog.showModal === 'function') feedbackDialog.showModal();
    else alert('你的浏览器不支持原生对话框，请升级或换一个试试～');
  });
  feedbackSubmit?.addEventListener('click', async (e) => {
    e.preventDefault();
    const text = feedbackText.value.trim();
    if (!text) return feedbackDialog.close();
    try {
      const resp = await fetch('/feedback', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ text })
      });
      const data = await resp.json();
      alert(data?.ok ? '感谢反馈！' : ('提交失败：' + (data?.error || '未知错误')));
    } catch (err) {
      alert('提交失败：' + (err?.message || String(err)));
    } finally {
      feedbackDialog.close();
    }
  });

  function setLoading(isLoading) {
    generateBtn.disabled = isLoading;
    btnText.textContent = isLoading ? '正在生成...' : '生成';
    spinner.classList.toggle('hidden', !isLoading);
  }
  function safeSetResultStatus(text) {
    resultContainer.replaceChildren();
    const box = document.createElement('div');
    box.className = 'nb-result';
    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
    resultContainer.appendChild(box);
  }

  // 原始 base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 压缩为 DataURL（最长边 1280，quality 0.9）
  async function fileToCompressedDataURL(file, maxW = 1280, maxH = 1280, quality = 0.9) {
    if (!file.type.startsWith('image/')) return await fileToBase64(file);
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const ratio = Math.min(maxW / width, maxH / height, 1);
    const w = Math.round(width * ratio);
    const h = Math.round(height * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);

    // 优先 jpeg（体积更小）；png 图保留 png
    const mime = file.type.includes('png') ? 'image/png' : 'image/jpeg';
    return canvas.toDataURL(mime, quality);
  }

  async function dataURLtoFile(dataUrl, filename) {
    const r = await fetch(dataUrl);
    const blob = await r.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
  }
  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = filename; a.click();
  }
});
// --- END OF FILE script.js ---
