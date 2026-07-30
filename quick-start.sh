#!/usr/bin/env bash
# mosaic — quick start script
# Usage: ./quick-start.sh {start|stop|restart|status|logs|help}
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/mosaic"
PID_FILE="$CONFIG_DIR/mosaic.pid"
LOG_FILE="$CONFIG_DIR/mosaic.log"
VENV="$SCRIPT_DIR/.venv"
PORT="${PORT:-47500}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

ensure_venv() {
  mkdir -p "$CONFIG_DIR"
  if [[ ! -d "$VENV" ]]; then
    echo -e "${YELLOW}Creating virtualenv with uv...${NC}"
    uv venv "$VENV" -q
    uv pip install -q -p "$VENV/bin/python" -r "$SCRIPT_DIR/backend/requirements.txt"
  fi
}

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  if is_running; then
    echo -e "${YELLOW}mosaic already running (pid $(cat "$PID_FILE"))${NC}"
    return 0
  fi
  ensure_venv
  cd "$SCRIPT_DIR"
  nohup "$VENV/bin/uvicorn" backend.app:app --host 127.0.0.1 --port "$PORT" \
    >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1
  if is_running; then
    echo -e "${GREEN}mosaic started on http://localhost:$PORT/mosaic/ (pid $(cat "$PID_FILE"))${NC}"
  else
    echo -e "${RED}mosaic failed to start — see $LOG_FILE${NC}"
    exit 1
  fi
}

stop() {
  if is_running; then
    kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE"
    echo -e "${GREEN}mosaic stopped${NC}"
  else
    echo -e "${YELLOW}mosaic is not running${NC}"
  fi
}

status() {
  if is_running; then
    echo -e "${GREEN}mosaic running (pid $(cat "$PID_FILE")) on port $PORT${NC}"
  else
    echo -e "${RED}mosaic is not running${NC}"
  fi
}

case "${1:-help}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  logs) tail -f "$LOG_FILE" ;;
  help|*)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    echo "Config: $CONFIG_DIR   Port: $PORT (override with PORT=xxxx)"
    ;;
esac
