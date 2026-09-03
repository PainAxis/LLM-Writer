# 多阶段构建 Dockerfile
FROM node:22-alpine AS base
WORKDIR /app
# 复制依赖清单
COPY package.json package-lock.json ./

# 开发环境
FROM base AS development
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]

# 构建阶段
FROM base AS builder
RUN npm ci
COPY . .
RUN npm run build

# 生产环境
FROM nginx:alpine AS production
# 复制自定义nginx配置
COPY nginx.conf /etc/nginx/nginx.conf
# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
