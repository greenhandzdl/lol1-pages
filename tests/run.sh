#!/usr/bin/env bash
# 测试入口。环境不存在就建，然后跑。
#
# 为什么不直接写 `pytest`：playwright 不是标准库，系统 Python 通常没有。
# venv 放在 .cache/ 下（已 gitignore），换机器首次跑会自动装。
set -euo pipefail

cd "$(dirname "$0")/.."
VENV="${TEST_VENV:-.cache/pyenv}"

if [ ! -x "$VENV/bin/python" ]; then
  echo "→ 建虚拟环境 $VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q playwright pytest
  "$VENV/bin/python" -m playwright install chromium
fi

# 无显示器环境需要 xvfb
if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a -s "-screen 0 1600x1000x24" "$VENV/bin/python" -m pytest "$@"
fi
exec "$VENV/bin/python" -m pytest "$@"
