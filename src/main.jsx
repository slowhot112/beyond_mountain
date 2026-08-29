import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// 全局错误兜底：把 WebView / Worker 里的报错暴露出来，方便定位
window.addEventListener('error', (e) => {
  console.error('[global error]', e.message, e.filename, e.lineno, e.colno, e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled rejection]', e.reason);
});

createRoot(document.getElementById('root')).render(<App />);
