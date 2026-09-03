#!/bin/bash

echo "🚀 部署LLM-Writer生产环境..."

# 检查Docker是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker未运行，请先启动Docker"
    exit 1
fi

# 停止现有容器
echo "🛑 停止现有容器..."
docker-compose --profile prod down

# 清理旧的镜像（可选）
read -p "是否清理旧的Docker镜像？(y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🧹 清理旧镜像..."
    docker image prune -f
fi

# 构建并启动生产环境
echo "🔨 构建并启动生产环境..."
docker-compose --profile prod up -d --build

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 10

# 检查服务状态
if docker-compose --profile prod ps | grep -q "Up"; then
    echo "✅ 生产环境部署成功！"
    echo "🌐 访问地址: http://localhost"
    echo "📋 查看日志: docker-compose --profile prod logs -f"
    echo "🛑 停止服务: docker-compose --profile prod down"
    echo "🔄 重启服务: docker-compose --profile prod restart"
else
    echo "❌ 部署失败，请检查日志:"
    docker-compose --profile prod logs
fi 