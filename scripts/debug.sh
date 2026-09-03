#!/bin/bash

echo "🔍 LLM-Writer Docker 调试工具"
echo "================================"

# 检查Docker状态
echo "1. 检查Docker状态..."
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker未运行或未安装"
    exit 1
else
    echo "✅ Docker正常运行"
fi

# 检查Docker Compose
echo "2. 检查Docker Compose..."
if ! docker-compose --version > /dev/null 2>&1; then
    echo "❌ Docker Compose未安装"
    exit 1
else
    echo "✅ Docker Compose可用"
    docker-compose --version
fi

# 检查端口占用
echo "3. 检查端口占用..."
echo "检查3000端口:"
netstat -tulpn 2>/dev/null | grep :3000 || echo "端口3000空闲"
echo "检查80端口:"
netstat -tulpn 2>/dev/null | grep :80 || echo "端口80空闲"

# 检查现有容器
echo "4. 检查现有容器..."
docker-compose ps

# 尝试构建镜像
echo "5. 尝试构建镜像..."
docker-compose build 2>&1

# 查看最近的日志
echo "6. 查看最近的日志..."
docker-compose logs --tail=50

echo "================================"
echo "调试完成！请查看上述信息来定位问题。" 