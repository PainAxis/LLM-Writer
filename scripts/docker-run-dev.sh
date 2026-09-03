#!/bin/bash

echo "🚀 使用Docker Run启动开发环境..."

# 检查Docker是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker未运行，请先启动Docker"
    exit 1
fi

# 停止并删除现有容器
echo "🛑 清理现有容器..."
docker stop llm-writer-dev 2>/dev/null || true
docker rm llm-writer-dev 2>/dev/null || true

# 构建开发镜像
echo "🔨 构建开发镜像..."
docker build --target development -t llm-writer:dev .

if [ $? -ne 0 ]; then
    echo "❌ 镜像构建失败"
    exit 1
fi

# 运行开发容器
echo "🎯 启动开发容器..."
docker run -d \
  --name llm-writer-dev \
  -p 3000:3000 \
  -v $(pwd):/app \
  -v /app/node_modules \
  -e NODE_ENV=development \
  --restart unless-stopped \
  llm-writer:dev

# 等待容器启动
echo "⏳ 等待容器启动..."
sleep 5

# 检查容器状态
if docker ps | grep -q "llm-writer-dev"; then
    echo "✅ 开发环境启动成功！"
    echo "🌐 访问地址: http://localhost:3000"
    echo "📋 查看日志: docker logs -f llm-writer-dev"
    echo "🛑 停止容器: docker stop llm-writer-dev"
    echo "🗑️  删除容器: docker rm llm-writer-dev"
else
    echo "❌ 容器启动失败，查看日志:"
    docker logs llm-writer-dev
fi 