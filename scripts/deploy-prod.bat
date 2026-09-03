@echo off
chcp 65001 >nul
echo 🚀 部署LLM-Writer生产环境...

REM 检查Docker是否运行
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker未运行，请先启动Docker
    pause
    exit /b 1
)

REM 停止现有容器
echo 🛑 停止现有容器...
docker-compose --profile prod down

REM 询问是否清理旧镜像
set /p cleanup="是否清理旧的Docker镜像？(y/N): "
if /i "%cleanup%"=="y" (
    echo 🧹 清理旧镜像...
    docker image prune -f
)

REM 构建并启动生产环境
echo 🔨 构建并启动生产环境...
docker-compose --profile prod up -d --build

REM 等待服务启动
echo ⏳ 等待服务启动...
timeout /t 10 /nobreak >nul

REM 检查服务状态
docker-compose --profile prod ps | findstr "Up" >nul
if %errorlevel% equ 0 (
    echo ✅ 生产环境部署成功！
    echo 🌐 访问地址: http://localhost
    echo 📋 查看日志: docker-compose --profile prod logs -f
    echo 🛑 停止服务: docker-compose --profile prod down
    echo 🔄 重启服务: docker-compose --profile prod restart
) else (
    echo ❌ 部署失败，请检查日志:
    docker-compose --profile prod logs
)

pause 