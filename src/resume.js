// 模块③：简历解析前端工具（PDF/DOCX/TXT/图片/内置样例 → 文本 → /api/resume 抽取）
// 链路策略（D-10，2026-08-30）：浏览器端解析为主链路（pdfjs / mammoth / tesseract.js，零服务端依赖，
// 部署环境不需要 Python）；服务端 MarkItDown（md_server.py）为**可选拓展**，仅用于
// 浏览器解析不了的格式（xls / ppt / doc 等冷门格式）兜底，评委演示链路不依赖它。
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

// 调 Node 后端 /api/parse-doc（可选拓展：MarkItDown 服务，未启动会失败）
export async function parseDocViaServer(file, onProgress) {
  const fd = new FormData();
  fd.append('file', file, file.name || 'resume.bin');
  onProgress && onProgress(10);
  const data = await api('/api/parse-doc', { method: 'POST', body: fd });
  onProgress && onProgress(100);
  return data.text;
}

// PDF → 文本（pdfjs，文字层）
async function pdfToText(file) {
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

// 从 File 提取纯文本
export async function fileToText(file, onOcrProgress) {
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  console.log('[fileToText] type:', type, 'name:', name);

  // 1) 纯文本类直接前端读，最稳
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown') ||
      (type.startsWith('text/') && !type.includes('html'))) {
    return await file.text();
  }

  // 2) 图片：前端 tesseract.js OCR
  const isImage = type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/.test(name);
  if (isImage) {
    const T = await getTesseract();
    onOcrProgress && onOcrProgress(5);
    const res = await T.recognize(file, 'chi_sim+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && onOcrProgress) onOcrProgress(Math.round(5 + m.progress * 90));
      },
    });
    const text = (res.data && res.data.text) || '';
    console.log('[fileToText] tesseract text length:', text.length);
    onOcrProgress && onOcrProgress(100);
    if (text && text.trim()) return text;
    throw new Error('图片文字识别失败或结果为空，请检查图片清晰度，或改用 PDF / 文字版简历');
  }

  // 3) PDF：前端 pdfjs 读文字层（主链路）
  if (name.endsWith('.pdf')) {
    let scannedLike = false;
    try {
      const text = await pdfToText(file);
      console.log('[fileToText] pdfjs text length:', text.length);
      if (text && text.trim()) return text;
      scannedLike = true; // 文字层为空，大概率是扫描版 PDF
    } catch (e) {
      console.warn('[fileToText] pdfjs failed:', e.message);
    }
    // 可选拓展兜底：MarkItDown 服务若在运行（未来配合 markitdown-ocr 插件可覆盖扫描件），值得一试
    try {
      const text = await parseDocViaServer(file);
      if (text && text.trim()) return text;
    } catch (e) {
      console.warn('[fileToText] server MarkItDown failed:', e.message);
    }
    throw new Error(scannedLike
      ? '该 PDF 没有文字层（可能是扫描版）。请上传文字版 PDF / DOCX / TXT，或将内容粘贴为文字'
      : 'PDF 解析失败，请重试或改用文字粘贴');
  }

  // 4) DOCX：前端 mammoth（主链路）
  if (name.endsWith('.docx')) {
    try {
      const buf = await file.arrayBuffer();
      const res = await mammoth.extractRawText({ arrayBuffer: buf });
      if (res.value && res.value.trim()) return res.value;
    } catch (e) {
      console.warn('[fileToText] mammoth failed:', e.message);
    }
    // 可选拓展兜底：MarkItDown 服务
    try {
      const text = await parseDocViaServer(file);
      if (text && text.trim()) return text;
    } catch (e) { /* 服务未启动则忽略 */ }
    throw new Error('DOCX 解析失败，请重试或改用文字粘贴');
  }

  // 5) 其余冷门格式（.doc / .xls / .ppt / .html 等）：仅可选拓展的 MarkItDown 能解析
  try {
    const text = await parseDocViaServer(file, onOcrProgress);
    if (text && text.trim()) return text;
    throw new Error('服务端返回空文本');
  } catch (e) {
    console.warn('[fileToText] server MarkItDown failed:', e.message);
  }
  // 实在解析不了：当作纯文本试试
  try {
    const t = await file.text();
    if (t && t.trim()) return t;
  } catch {}
  throw new Error('无法解析该文件。支持 PDF / DOCX / TXT / MD / 图片，或将内容粘贴为文字');
}

// 加载内置样例（public/sample-resume.md，随 Vite 构建打包到 dist/）
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
