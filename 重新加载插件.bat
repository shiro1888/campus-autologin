@echo off
chcp 936 >nul
title 重新加载 Chrome 插件
echo.
echo   正在打开 Chrome 扩展管理页...
echo.
echo   请在页面里找到「校园网自动登录」，点它卡片上的 刷新 按钮（圆圈箭头）。
echo   标题右边会显示版本号，看到 v1.1.0 就说明更新成功了。
echo.
start "" chrome.exe "chrome://extensions/"
timeout /t 3 >nul
exit /b 0