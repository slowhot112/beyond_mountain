// 模块③：简历解析前端工具（PDF/DOCX/TXT/图片/内置样例 → 文本 → /api/resume 抽取）
import { api } from './lib.js';
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as mammoth from 'mammoth';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

// tesseract.js 动态加载：只在处理图片简历时才请求训练数据，减少首屏包体积
let Tesseract = null;
async function getTesseract() {
  if (!Tesseract) Tesseract = await import('tesseract.js');
  return Tesseract;
}

// 调 Node 后端 /api/parse-doc（MarkItDown 服务）做文档转文本
// 覆盖 PDF / Word / Excel / PPT / 图片(含扫描件OCR) / HTML / TXT / MD 等
export async function parseDocViaServer(file, onProgress) {
  const fd = new FormData();
  fd.append('file', file, file.name || 'resume.bin');
  onProgress && onProgress(10);
  const data = await api('/api/parse-doc', { method: 'POST', body: fd });
  onProgress && onProgress(100);
  return data.text;
}

// 从 File 提取纯文本
// 策略：优先走服务端 MarkItDown（覆盖最广，含扫描件）；失败再回退前端 pdfjs/tesseract
export async function fileToText(file, onOcrProgress) {
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  console.log('[fileToText] type:', type, 'name:', name);

  // 纯文本类直接前端读，最稳
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown') ||
      (type.startsWith('text/') && !type.includes('html'))) {
    return await file.text();
  }

  // 图片类：优先用前端 tesseract.js OCR（对简历图片通常比服务端 MarkItDown 更完整），再拿服务端结果做补充
  const isImage = type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/.test(name);
  if (isImage) {
    try {
      const T = await getTesseract();
      onOcrProgress && onOcrProgress(5);
      const res = await T.recognize(file, 'chi_sim+eng', {
        logger: (m) => {
          if (m.status === 'recognizing text' && onOcrProgress) onOcrProgress(Math.round(5 + m.progress * 90));
        },
      });
      let text = (res.data && res.data.text) || '';
      console.log('[fileToText] tesseract text length:', text.length);
      // 同时请求服务端 MarkItDown，合并可能漏掉的部分
      try {
        const serverText = await parseDocViaServer(file, (p) => {});
        if (serverText && serverText.trim().length > text.length * 0.3) {
          text = text + '\n\n[服务端补充识别]\n' + serverText;
          console.log('[fileToText] merged server text length:', serverText.length);
        }
      } catch (e) {
        console.warn('[fileToText] server supplement failed:', e.message);
      }
      onOcrProgress && onOcrProgress(100);
      if (text && text.trim()) return text;
    } catch (e) {
      console.warn('[fileToText] tesseract failed:', e.message);
      // 失败再纯走服务端
    }
  }

  // 其余（PDF / DOCX / DOC / 图片兜底 / PPT / XLS 等）走服务端 MarkItDown
  try {
    console.log('[fileToText] try server MarkItDown');
    const text = await parseDocViaServer(file, onOcrProgress);
    if (text && text.trim()) {
      console.log('[fileToText] server text length:', text.length);
      return text;
    }
    throw new Error('服务端返回空文本');
  } catch (serverErr) {
    console.warn('[fileToText] server MarkItDown failed:', serverErr.message);
    // 回退：前端本地解析 PDF / DOCX / 图片
    if (name.endsWith('.pdf')) {
      console.log('[fileToText] fallback PDF (pdfjs)');
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      let text = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        text += tc.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
      }
      return text;
    }
    if (name.endsWith('.docx')) {
      console.log('[fileToText] fallback DOCX (mammoth)');
      const buf = await file.arrayBuffer();
      const res = await mammoth.extractRawText({ arrayBuffer: buf });
      return res.value;
    }
    if (isImage) {
      throw new Error('图片文字识别失败：' + (serverErr.message || '请检查图片清晰度，或改用 PDF/文字版简历'));
    }
    // 实在解析不了：当作纯文本试试
    try { return await file.text(); } catch {}
    throw new Error('无法解析该文件，请上传 PDF / Word / 图片，或将内容粘贴为 TXT');
  }
}

// 加载内置样例
export async function loadSample() {
  const r = await fetch('/sample-resume.md');
  return await r.text();
}

// 调后端抽取结构化字段
export async function extractResume(text) {
  const data = await api('/api/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return data;
}
