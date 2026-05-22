#!/bin/bash
# VPS nginx 反代部署脚本
# 在阿里云 Web Terminal 中以 root 执行
# 目标：nginx 反代到 Mac mini 的 Tailscale IP (100.71.171.11:3000)

set -e

MAC_MINI_TS_IP="100.71.171.11"
MAC_MINI_PORT="3000"

echo "=== Step 1: 检查 Tailscale 连通性 ==="
if tailscale ping -c 1 "$MAC_MINI_TS_IP" > /dev/null 2>&1; then
    echo "✓ Tailscale 到 Mac mini 通"
else
    echo "✗ Tailscale 不通，请检查 VPS 是否加入了 Tailnet"
    exit 1
fi

echo "=== Step 2: 安装 nginx ==="
if command -v nginx &> /dev/null; then
    echo "✓ nginx 已安装: $(nginx -v 2>&1)"
else
    if command -v apt-get &> /dev/null; then
        apt-get update && apt-get install -y nginx
    elif command -v yum &> /dev/null; then
        yum install -y nginx
    else
        echo "✗ 不支持的包管理器"
        exit 1
    fi
    echo "✓ nginx 安装完成"
fi

echo "=== Step 3: 写入 nginx 配置 ==="
cat > /etc/nginx/conf.d/yibai-fission.conf << 'NGINX_EOF'
server {
    listen 80;
    server_name _;

    # 客户上传参考图最大 20MB（nginx 默认 1MB 会导致 413，前端报
    # "Unexpected token '<'" —— 实际是 nginx 返回 HTML 错误页而非 JSON）
    # Next.js 应用层 MAX_RAW_BYTES=7.5MB 是更严格的二次校验
    client_max_body_size 20M;

    location / {
        proxy_pass http://100.71.171.11:3000;

        # 长连接支持（生图任务 5-8 分钟）
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_connect_timeout 60s;

        # 透传头信息
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
NGINX_EOF
echo "✓ 配置已写入 /etc/nginx/conf.d/yibai-fission.conf"

echo "=== Step 4: 测试 nginx 配置 ==="
nginx -t

echo "=== Step 5: 启动 nginx ==="
systemctl enable nginx
systemctl restart nginx
echo "✓ nginx 已启动并设置开机自启"

echo "=== Step 6: 检查防火墙 ==="
if command -v firewall-cmd &> /dev/null; then
    firewall-cmd --permanent --add-port=80/tcp
    firewall-cmd --reload
    echo "✓ firewalld 已开放 80 端口"
elif command -v ufw &> /dev/null; then
    ufw allow 80/tcp
    echo "✓ ufw 已开放 80 端口"
else
    echo "⚠ 未检测到防火墙工具，请手动确认 80 端口已开放"
    echo "  阿里云安全组也需要放行 80 端口（入方向）"
fi

echo ""
echo "=== 部署完成！==="
echo "公网地址: http://$(curl -s ifconfig.me)"
echo ""
echo "验证命令（在 VPS 上执行）:"
echo "  curl -s http://127.0.0.1/api/health"
echo ""
echo "阿里云安全组检查:"
echo "  控制台 → ECS → 安全组 → 入方向 → 添加 80/TCP"
