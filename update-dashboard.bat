@echo off
chcp 65001 > nul

cd /d C:\bi-dashboard

echo ========================================
echo BI Dashboard CSV Update
echo ========================================
echo.

echo [1/3] ファイルを追加しています...
git add .

echo.
echo [2/3] コミットしています...
git commit -m "Update CSV data"

if errorlevel 1 (
    echo.
    echo 変更がない、またはコミットに失敗しました。
    echo.
    pause
    exit /b
)

echo.
echo [3/3] GitHubへ送信しています...
git push

if errorlevel 1 (
    echo.
    echo GitHubへの送信に失敗しました。
    echo.
    pause
    exit /b
)

echo.
echo ========================================
echo 更新完了！
echo Vercelの自動デプロイが開始されます。
echo ========================================
echo.

pause