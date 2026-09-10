// 模块③：简历解析前端工具（PDF/DOCX/TXT/图片/内置样例 → 文本 → /api/resume 抽取）
// 链路策略（D-10，2026-08-30）：浏览器端解析为主链路（pdfjs / mammoth / tesseract.js，零服务端依赖，
// 部署环境不需要 Python）；服务端 MarkItDown（md_server.py）为**可选拓展**，仅用于
// 浏览器解析不了的格式（xls / ppt / doc 等冷门格式）兜底，评委演示链路不依赖它。
import { api } from './lib.js';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as mammoth from 'mammoth';

// pdfjs 主模块在加载时会访问 DOM，顶层静态 import 在部分 WebView 下会拿到 null 而崩白屏。
// 改为首次解析 PDF 时才动态加载，避开首屏初始化（landing 页不再引入 pdfjs）。
let pdfjsMod = null;
async function getPdfJs() {
  if (!pdfjsMod) {
    pdfjsMod = await import('pdfjs-dist');
    pdfjsMod.GlobalWorkerOptions.workerSrc = workerSrc;
  }
  return pdfjsMod;
}

// tesseract.js 动态加载：只在处理图片简历时才请求训练数据，减少首屏包体积
let Tesseract = null;
async function getTesseract() {
  if (!Tesseract) Tesseract = await import('tesseract.js');
  return Tesseract;
}

// PDF → 文本（pdfjs，文字层）
async function pdfToText(file) {
  const pdfjs = await getPdfJs();
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
    onOcrProgress && onOcrProgress(100);
    if (text && text.trim()) return text;
    throw new Error('这张图里的字我没认出来，换个清楚点的图，或用文字版简历');
  }

  // 3) PDF：前端 pdfjs 读文字层（主链路）
  if (name.endsWith('.pdf')) {
    let scannedLike = false;
    try {
      const text = await pdfToText(file);
      if (text && text.trim()) return text;
      scannedLike = true; // 文字层为空，大概率是扫描版 PDF
    } catch (e) { /* 不记录文件信息；由下方给用户可操作的提示 */ }
    throw new Error(scannedLike
      ? '这个 PDF 像是扫描件（整页就是张图），复制不出字。换文字版 PDF / Word / TXT，或把内容粘过来'
      : '这个 PDF 我没读出来，再试一次，或直接把文字粘过来');
  }

  // 4) DOCX：前端 mammoth（主链路）
  if (name.endsWith('.docx')) {
    try {
      const buf = await file.arrayBuffer();
      const res = await mammoth.extractRawText({ arrayBuffer: buf });
      if (res.value && res.value.trim()) return res.value;
    } catch (e) { /* 不记录文件信息；由下方给用户可操作的提示 */ }
    throw new Error('这个 Word 文件我没读出来，再试一次，或直接把文字粘过来');
  }

  // 5) 其余格式只在浏览器尝试按文本读取；原始文件不上传后端。
  try {
    const t = await file.text();
    if (t && t.trim()) return t;
  } catch {}
  throw new Error('这个文件我读不了。支持 PDF / Word / TXT / 图片，或直接把内容粘过来');
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
