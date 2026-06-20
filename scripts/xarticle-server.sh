#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8765}"
PID_FILE="$ROOT_DIR/.xarticle-server.pid"
LOG_FILE="$ROOT_DIR/.xarticle-server.log"
SERVER="$ROOT_DIR/xarticle-server.js"

usage() {
  cat <<EOF
X Article Markdown Publisher local server

Usage:
  $0 start                 Start dashboard only, then load Markdown in browser
  $0 start article.md      Start and preload a Markdown file
  $0 restart               Restart dashboard only
  $0 restart article.md    Restart and preload a Markdown file
  $0 status                Show server status and recent log
  $0 stop                  Stop the server started by this script
  $0 help                  Show this help

Examples:
  $0 start
  $0 start "/Users/you/article.md"
  $0 status
  $0 stop

Environment:
  PORT=8765               Override the dashboard port

Dashboard:
  http://localhost:$PORT
EOF
}

print_start_hint() {
  local article="${1:-}"
  echo
  echo "Dashboard: http://localhost:$PORT"
  echo "Log: $LOG_FILE"
  if [[ -n "$article" ]]; then
    echo "Article: $article"
    echo "Next: open the dashboard or X Articles editor, then click the extension button."
  else
    echo "Article: none loaded"
    echo "Next: open the dashboard and load Markdown by local path, dropped file, or pasted text."
  fi
}

pid_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  [[ -f "$PID_FILE" ]] && tr -d '[:space:]' < "$PID_FILE" || true
}

port_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

server_ready() {
  curl -fsS "http://localhost:$PORT/status" >/dev/null 2>&1
}

start_server() {
  local article="${1:-}"
  local pid existing
  if [[ -n "$article" && ! -f "$article" ]]; then
    echo "Markdown file not found: $article"
    echo "Tip: run '$0 start' without a file to load Markdown from the dashboard."
    exit 1
  fi

  pid="$(read_pid)"
  if pid_running "$pid"; then
    echo "X Article server is already running. PID: $pid"
    print_start_hint "$article"
    return 0
  fi

  existing="$(port_pid)"
  if [[ -n "$existing" ]]; then
    if server_ready; then
      echo "$existing" > "$PID_FILE"
      echo "X Article server is already running on port $PORT. PID: $existing"
      print_start_hint "$article"
      return 0
    fi
    echo "Port $PORT is already in use by PID $existing, but it does not look like this server."
    echo "Not starting to avoid stopping an unknown process."
    exit 1
  fi

  : > "$LOG_FILE"
  if [[ -n "$article" ]]; then
    nohup node "$SERVER" "$article" "$PORT" </dev/null >> "$LOG_FILE" 2>&1 &
  else
    nohup node "$SERVER" "" "$PORT" </dev/null >> "$LOG_FILE" 2>&1 &
  fi
  pid="$!"
  disown "$pid" 2>/dev/null || true

  local ready=0
  for _ in {1..50}; do
    if ! pid_running "$pid"; then
      break
    fi
    if server_ready; then
      ready=1
      break
    fi
    sleep 0.2
  done
  if [[ "$ready" != "1" ]]; then
    echo "X Article server failed to start. Recent log:"
    tail -n 40 "$LOG_FILE" || true
    exit 1
  fi

  echo "$pid" > "$PID_FILE"
  echo "X Article server started. PID: $pid"
  print_start_hint "$article"
}

stop_server() {
  local pid existing
  pid="$(read_pid)"
  if pid_running "$pid"; then
    echo "Stopping X Article server PID $pid..."
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      pid_running "$pid" || break
      sleep 0.2
    done
    if pid_running "$pid"; then
      echo "Process did not stop after SIGTERM. Leaving it running."
      exit 1
    fi
    rm -f "$PID_FILE"
    echo "Stopped."
    return 0
  fi

  rm -f "$PID_FILE"
  existing="$(port_pid)"
  if [[ -n "$existing" ]]; then
    echo "No PID file process is running, but port $PORT is used by PID $existing."
    echo "Not killing unknown process."
    exit 1
  fi
  echo "X Article server is not running."
}

status_server() {
  local pid existing
  pid="$(read_pid)"
  if pid_running "$pid"; then
    echo "X Article server: running"
    echo "PID: $pid"
    echo "Port: $PORT"
    echo "Dashboard: http://localhost:$PORT"
  else
    echo "X Article server: not running from $PID_FILE"
    existing="$(port_pid)"
    if [[ -n "$existing" ]]; then
      echo "Port $PORT is occupied by PID $existing"
    fi
  fi
  echo "Log: $LOG_FILE"
  if [[ -f "$LOG_FILE" ]]; then
    echo "Recent log:"
    tail -n 20 "$LOG_FILE" || true
  fi
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  start)
    start_server "${1:-}"
    ;;
  stop)
    stop_server
    ;;
  restart)
    stop_server || true
    start_server "${1:-}"
    ;;
  status)
    status_server
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
