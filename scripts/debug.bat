@echo off
chcp 65001 >nul
echo 🔍 LLM-Writer Docker 调试工具
echo ================================

REM 检查Docker状态
echo 1. 检查Docker状态...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker未运行或未安装
    pause
    exit /b 1
) else (
    echo ✅ Docker正常运行
)

REM 检查Docker Compose
echo 2. 检查Docker Compose...
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker Compose未安装
    pause
    exit /b 1
) else (
    echo ✅ Docker Compose可用
    docker-compose --version
)

REM 检查端口占用
echo 3. 检查端口占用...
echo 检查3000端口:
netstat -an | findstr :3000
if %errorlevel% neq 0 echo 端口3000空闲

echo 检查80端口:
netstat -an | findstr :80
if %errorlevel% neq 0 echo 端口80空闲

REM 检查现有容器
echo 4. 检查现有容器...
docker-compose ps

REM 尝试构建镜像
echo 5. 尝试构建镜像...
docker-compose build

REM 查看最近的日志
echo 6. 查看最近的日志...
docker-compose logs --tail=50

echo ================================
echo 调试完成！请查看上述信息来定位问题。
pause 