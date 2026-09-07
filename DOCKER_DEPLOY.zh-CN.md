# Docker 部署指南

[English](DOCKER_DEPLOY.md) | [简体中文](DOCKER_DEPLOY.zh-CN.md)

本项目支持使用 Docker 进行快速部署，包含开发环境和生产环境的配置。

## 前置要求

- Docker >= 20.10
- Docker Compose >= 2.0

## 快速开始

### 开发环境部署

```bash
# 启动开发环境
docker-compose --profile dev up -d

# 查看日志
docker-compose --profile dev logs -f app-dev

# 停止开发环境
docker-compose --profile dev down
```

开发环境将在 http://localhost:3000 运行，支持热重载。

### 生产环境部署

```bash
# 构建并启动生产环境
docker-compose --profile prod up -d

# 查看日志
docker-compose --profile prod logs -f app-prod

# 停止生产环境
docker-compose --profile prod down
```

生产环境将在 http://localhost (端口80) 运行。

### 外部 Nginx 模式（可选）

适合已在宿主机运行 Nginx、只需静态托管的场景：挂载本地 `dist/` 构建产物与 `nginx.conf`，端口 8080。需先执行 `npm run build` 生成 dist：

```bash
npm run build
docker-compose --profile external-nginx up -d
# 访问 http://localhost:8080
```

## 详细配置

### 单独使用 Dockerfile

#### 开发环境
```bash
# 构建开发镜像
docker build --target development -t llm-writer:dev .

# 运行开发容器
docker run -d -p 3000:3000 -v $(pwd):/app -v /app/node_modules --name llm-writer-dev llm-writer:dev
```

#### 生产环境
```bash
# 构建生产镜像
docker build --target production -t llm-writer:prod .

# 运行生产容器
docker run -d -p 80:80 --name llm-writer-prod llm-writer:prod
```

## 故障排查

### 快速诊断工具

```bash
# Windows
scripts\debug.bat

# Linux/Mac
chmod +x scripts/debug.sh
./scripts/debug.sh
```

### 查看错误日志

```bash
# 查看构建过程错误
docker-compose build --no-cache

# 查看容器启动日志
docker-compose logs

# 实时跟踪日志
docker-compose logs -f

# 前台启动查看详细输出
docker-compose --profile dev up
```

### 常见问题

1. **端口被占用**
   ```bash
   # 检查端口占用
   netstat -tulpn | grep :3000
   # 修改 docker-compose.yml 中的端口映射
   ```

2. **构建失败**
   ```bash
   # 清理构建缓存
   docker builder prune
   # 重新构建
   docker-compose build --no-cache
   ```

3. **容器无法启动**
   ```bash
   # 查看详细错误信息
   docker-compose logs
   # 检查容器状态
   docker-compose ps
   ```

4. **权限问题（Linux）**
   ```bash
   # 将用户添加到docker组
   sudo usermod -aG docker $USER
   newgrp docker
   ```
