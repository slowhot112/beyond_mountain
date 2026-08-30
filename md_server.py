"""
知乎炼金术 · 文档解析服务（MarkItDown 封装）
职责：接收上传的文档（PDF/Word/Excel/PPT/图片/HTML/TXT/MD 等），
      用 MarkItDown 转换为纯文本/Markdown，返回给 Node 后端。
仅做"文档 → 文本"转换，不涉及任何大模型 API Key。

启动：
    pip install "markitdown[all]"
    python md_server.py            # 默认监听 127.0.0.1:8011（仅本机）
    PORT=9000 python md_server.py  # 自定义端口
    HOST=0.0.0.0 python md_server.py  # 监听所有网卡（部署到 Render/Railway 等平台作第二个服务时必须，
                                      # Node 后端通过 MD_SERVICE_URL 环境变量指向本服务）

接口：
    POST /api/convert
        form-data: file=<二进制文件>
        返回: {"ok": true, "text": "..."}
        OR:   {"ok": false, "code": "...", "message": "..."}
    GET  /api/health
        返回: {"ok": true}
"""

import os
import sys
import json

try:
    from markitdown import MarkItDown
except Exception as e:  # noqa
    print("MarkItDown 未安装，请先执行: pip install \"markitdown[all]\"", file=sys.stderr)
    raise

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import cgi

PORT = int(os.environ.get("PORT", "8011"))
# 默认仅监听本机；部署到 PaaS（Render/Railway 第二服务）时需 HOST=0.0.0.0 才能被 Node 后端访问
HOST = os.environ.get("HOST", "127.0.0.1")
# 单文件上限 30MB，防止过大请求
MAX_SIZE = 30 * 1024 * 1024


def convert_file(file_bytes, filename=""):
    """调用 MarkItDown 把文档字节转为 Markdown 文本。"""
    md = MarkItDown()
    # MarkItDown 支持从文件路径或二进制流转换；这里用临时文件最稳
    import tempfile
    suffix = os.path.splitext(filename)[1] or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
        tf.write(file_bytes)
        tmp_path = tf.name
    try:
        result = md.convert(tmp_path)
        return result.text_content or ""
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:  # noqa
            pass


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urlparse(self.path)
        if p.path == "/api/health":
            self._send_json({"ok": True})
        else:
            self._send_json({"ok": False, "code": "NOT_FOUND", "message": "未找到接口"}, 404)

    def do_POST(self):
        p = urlparse(self.path)
        if p.path != "/api/convert":
            self._send_json({"ok": False, "code": "NOT_FOUND", "message": "未找到接口"}, 404)
            return
        try:
            ctype = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in ctype:
                self._send_json({"ok": False, "code": "BAD_REQUEST", "message": "需要 multipart/form-data 上传文件"}, 400)
                return
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_SIZE:
                self._send_json({"ok": False, "code": "TOO_LARGE", "message": "文件超过 30MB 限制"}, 413)
                return
            # 解析 multipart
            fp = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": ctype,
                    "CONTENT_LENGTH": str(length),
                },
            )
            if "file" not in fp:
                self._send_json({"ok": False, "code": "NO_FILE", "message": "缺少 file 字段"}, 400)
                return
            item = fp["file"]
            data = item.file.read()
            filename = item.filename or ""
            text = convert_file(data, filename)
            self._send_json({"ok": True, "text": text})
        except Exception as e:  # noqa
            self._send_json({"ok": False, "code": "CONVERT_FAILED", "message": str(e)}, 500)

    def log_message(self, *args):  # 静默日志
        pass


if __name__ == "__main__":
    print(f"MarkItDown 文档解析服务已启动: http://{HOST}:{PORT}")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.serve_forever()
