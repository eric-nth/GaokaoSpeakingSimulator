@echo off
setlocal EnableDelayedExpansion

set n=1

for /f "delims=" %%D in ('dir /b /ad ^| sort') do (
    rem 跳过已经是纯数字名称的目标冲突，可按需删除此判断
    ren "%%D" "!n!"
    set /a n+=1
)

endlocal
echo Done.
pause
