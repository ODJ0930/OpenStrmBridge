#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="OpenStrmBridge"
SERVICE_NAME="openstrmbridge"
REPO="ODJ0930/OpenStrmBridge"
INSTALL_DIR="${OPENSTRMBRIDGE_INSTALL_DIR:-/opt/openstrmbridge}"
ENV_FILE="${OPENSTRMBRIDGE_ENV_FILE:-/etc/default/openstrmbridge}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
DEFAULT_PORT="${OPENSTRMBRIDGE_DEFAULT_PORT:-5174}"
DEFAULT_HOST="${OPENSTRMBRIDGE_DEFAULT_HOST:-0.0.0.0}"
MANAGER_BIN="/usr/local/bin/openstrmbridge"

info() {
	printf '[%s] %s\n' "$APP_NAME" "$*"
}

warn() {
	printf '[%s] %s\n' "$APP_NAME" "$*" >&2
}

die() {
	warn "$*"
	exit 1
}

require_root() {
	if [ "${EUID:-$(id -u)}" -ne 0 ]; then
		die "请使用 root 权限执行此脚本。"
	fi
}

require_debian_or_ubuntu() {
	if [ ! -r /etc/os-release ]; then
		die "无法识别系统版本，仅支持 Debian / Ubuntu。"
	fi

	# shellcheck disable=SC1091
	. /etc/os-release

	case ",${ID:-},${ID_LIKE:-}," in
	*debian* | *ubuntu*) ;;
	*) die "当前系统不是 Debian / Ubuntu，已停止执行。" ;;
	esac
}

install_dependencies() {
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get install -y ca-certificates curl gzip tar
}

detect_arch() {
	case "$(uname -m)" in
	x86_64 | amd64) printf 'x64' ;;
	aarch64 | arm64) printf 'arm64' ;;
	*) die "当前 CPU 架构暂不支持：$(uname -m)" ;;
	esac
}

latest_release_asset_url() {
	local arch="$1"
	local version="${OPENSTRMBRIDGE_VERSION:-latest}"

	if [ "$version" != "latest" ]; then
		printf 'https://github.com/%s/releases/download/%s/openstrmbridge-%s-debian-%s.tar.gz\n' \
			"$REPO" "$version" "$version" "$arch"
		return
	fi

	local release_json
	release_json="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")"

	printf '%s\n' "$release_json" |
		sed -n "s/.*\"browser_download_url\": \"\\([^\"]*openstrmbridge-v[^\"]*-debian-${arch}\\.tar\\.gz\\)\".*/\\1/p" |
		sed -n '1p'
}

read_env_value() {
	local key="$1"
	local fallback="${2:-}"

	if [ -f "$ENV_FILE" ]; then
		local value
		value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"

		if [ -n "$value" ]; then
			printf '%s' "$value"
			return
		fi
	fi

	printf '%s' "$fallback"
}

set_env_value() {
	local key="$1"
	local value="$2"
	local env_dir
	env_dir="$(dirname "$ENV_FILE")"

	mkdir -p "$env_dir"
	touch "$ENV_FILE"
	chmod 600 "$ENV_FILE"

	local temp_file
	temp_file="$(mktemp)"

	awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" >"$temp_file"

	cat "$temp_file" >"$ENV_FILE"
	rm -f "$temp_file"
	chmod 600 "$ENV_FILE"
}

ensure_env_file() {
	local port
	port="$(read_env_value OPENSTRMBRIDGE_BACKEND_PORT "$DEFAULT_PORT")"

	set_env_value OPENSTRMBRIDGE_BACKEND_HOST "$DEFAULT_HOST"
	set_env_value OPENSTRMBRIDGE_BACKEND_PORT "$port"
	set_env_value OPENSTRMBRIDGE_DATA_DIR "$INSTALL_DIR/data"
	set_env_value OPENSTRMBRIDGE_WEB_DIR "$INSTALL_DIR/dist"
	set_env_value OPENSTRMBRIDGE_GE2O_BINARY "$INSTALL_DIR/resources/bin/ge2o"
	set_env_value OPENSTRMBRIDGE_BACKEND_PUBLIC_URL "http://${DEFAULT_HOST}:${port}"
	set_env_value OPENSTRMBRIDGE_STRM_DIR "$INSTALL_DIR/strm"
}

write_service() {
	cat >"$SERVICE_FILE" <<SERVICE
[Unit]
Description=OpenStrmBridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/runtime/node/bin/node ${INSTALL_DIR}/server/storage-check-server.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

	systemctl daemon-reload
}

install_manager_command() {
	local source_path="${BASH_SOURCE[0]}"

	if [ -r "$source_path" ]; then
		install -m 755 "$source_path" "$MANAGER_BIN"
	fi
}

stop_service() {
	if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
		systemctl stop "$SERVICE_NAME" || true
	fi
}

start_service() {
	systemctl enable --now "$SERVICE_NAME"
}

restart_service_if_active() {
	if systemctl is-active --quiet "$SERVICE_NAME"; then
		systemctl restart "$SERVICE_NAME"
	fi
}

deploy_release() {
	local arch="$1"
	local url
	url="$(latest_release_asset_url "$arch")"

	if [ -z "$url" ]; then
		die "未找到适用于 Debian/Linux ${arch} 的 Release 资产。"
	fi

	local temp_dir archive extracted data_backup strm_backup previous_dir
	temp_dir="$(mktemp -d)"
	archive="$temp_dir/openstrmbridge.tar.gz"
	data_backup="$temp_dir/data"
	strm_backup="$temp_dir/strm"
	previous_dir="${INSTALL_DIR}.previous"

	info "下载 ${url}"
	curl -fL "$url" -o "$archive"
	tar -xzf "$archive" -C "$temp_dir"

	extracted="$(find "$temp_dir" -maxdepth 1 -type d -name "openstrmbridge-linux-${arch}" -print -quit)"

	if [ -z "$extracted" ]; then
		extracted="$(find "$temp_dir" -maxdepth 1 -type d -name 'openstrmbridge-*' -print -quit)"
	fi

	if [ -z "$extracted" ] || [ ! -d "$extracted" ]; then
		rm -rf "$temp_dir"
		die "Release 资产结构不符合预期。"
	fi

	mkdir -p "$(dirname "$INSTALL_DIR")"

	if [ -d "$INSTALL_DIR/data" ]; then
		mv "$INSTALL_DIR/data" "$data_backup"
	fi

	if [ -d "$INSTALL_DIR/strm" ]; then
		mv "$INSTALL_DIR/strm" "$strm_backup"
	fi

	rm -rf "$previous_dir"

	if [ -d "$INSTALL_DIR" ]; then
		mv "$INSTALL_DIR" "$previous_dir"
	fi

	mv "$extracted" "$INSTALL_DIR"

	if [ -d "$data_backup" ]; then
		rm -rf "$INSTALL_DIR/data"
		mv "$data_backup" "$INSTALL_DIR/data"
	fi

	if [ -d "$strm_backup" ]; then
		rm -rf "$INSTALL_DIR/strm"
		mv "$strm_backup" "$INSTALL_DIR/strm"
	fi

	chmod +x "$INSTALL_DIR/start.sh" "$INSTALL_DIR/runtime/node/bin/node" "$INSTALL_DIR/resources/bin/ge2o" 2>/dev/null || true
	rm -rf "$previous_dir" "$temp_dir"
}

validate_port() {
	local port="$1"

	if ! printf '%s' "$port" | grep -Eq '^[0-9]+$'; then
		return 1
	fi

	[ "$port" -ge 1 ] && [ "$port" -le 65535 ]
}

set_port() {
	local port="$1"
	validate_port "$port" || die "端口无效：${port}"

	set_env_value OPENSTRMBRIDGE_BACKEND_HOST "$DEFAULT_HOST"
	set_env_value OPENSTRMBRIDGE_BACKEND_PORT "$port"
	set_env_value OPENSTRMBRIDGE_BACKEND_PUBLIC_URL "http://${DEFAULT_HOST}:${port}"
	systemctl daemon-reload
}

change_port_interactive() {
	local current_port port
	current_port="$(read_env_value OPENSTRMBRIDGE_BACKEND_PORT "$DEFAULT_PORT")"

	while true; do
		read -r -p "请输入新的服务端口 [当前 ${current_port}]: " port
		port="${port:-$current_port}"

		if validate_port "$port"; then
			break
		fi

		warn "端口范围必须为 1-65535。"
	done

	set_port "$port"
	restart_service_if_active
	info "端口已更新为 ${port}。"
}

prompt_credentials() {
	local username password password_confirm

	while true; do
		read -r -p "请输入账号名称: " username
		username="${username#"${username%%[![:space:]]*}"}"
		username="${username%"${username##*[![:space:]]}"}"

		if [ -n "$username" ]; then
			break
		fi

		warn "账号名称不能为空。"
	done

	while true; do
		read -r -s -p "请输入账号密码: " password
		printf '\n'
		read -r -s -p "请再次输入账号密码: " password_confirm
		printf '\n'

		if [ -z "$password" ]; then
			warn "账号密码不能为空。"
			continue
		fi

		if [ "$password" != "$password_confirm" ]; then
			warn "两次输入的密码不一致。"
			continue
		fi

		break
	done

	write_runtime_auth_config "$username" "$password"
}

write_runtime_auth_config() {
	local username="$1"
	local password="$2"
	local node_bin="$INSTALL_DIR/runtime/node/bin/node"
	local config_file="$INSTALL_DIR/data/runtime-config.json"
	local revision
	revision="$(date -u +%Y%m%d%H%M%S)"

	if [ ! -x "$node_bin" ]; then
		die "未找到内置 Node.js 运行时，无法写入账号配置。"
	fi

	mkdir -p "$(dirname "$config_file")"

	"$node_bin" - "$config_file" "$username" "$password" "$revision" <<'NODE'
const fs = require('fs')
const path = require('path')
const [configFile, username, password, revision] = process.argv.slice(2)

fs.mkdirSync(path.dirname(configFile), { recursive: true })
fs.writeFileSync(
  configFile,
  `${JSON.stringify({ auth: { password, revision, username } }, null, 2)}\n`,
  { mode: 0o600 },
)
NODE

	chmod 600 "$config_file"
	info "账号密码已写入运行时配置。"
}

reset_account_password() {
	require_root

	if [ ! -d "$INSTALL_DIR" ]; then
		die "尚未安装 ${APP_NAME}。"
	fi

	prompt_credentials
	restart_service_if_active
}

prompt_optional_port_change() {
	local answer
	read -r -p "是否更换默认端口 ${DEFAULT_PORT}？[y/N]: " answer

	case "$answer" in
	y | Y | yes | YES) change_port_interactive ;;
	*) info "保留当前端口配置。" ;;
	esac
}

install_app() {
	require_root
	require_debian_or_ubuntu
	install_dependencies
	stop_service
	deploy_release "$(detect_arch)"
	ensure_env_file
	write_service
	install_manager_command
	prompt_credentials
	prompt_optional_port_change
	start_service
	info "安装完成，服务已启动。"
}

update_app() {
	require_root
	require_debian_or_ubuntu
	install_dependencies
	stop_service
	deploy_release "$(detect_arch)"
	ensure_env_file
	write_service
	install_manager_command
	start_service
	info "更新完成，服务已启动。"
}

close_app() {
	require_root
	stop_service
	info "服务已关闭。"
}

show_status() {
	require_root
	systemctl status "$SERVICE_NAME" --no-pager || true
}

print_menu() {
	cat <<MENU

${APP_NAME} 管理脚本
1. 安装 / 重装
2. 关闭服务
3. 更新程序
4. 更换端口
5. 重置账号密码
6. 查看状态
0. 退出

MENU
}

main_menu() {
	local choice
	print_menu
	read -r -p "请选择功能: " choice

	case "$choice" in
	1) install_app ;;
	2) close_app ;;
	3) update_app ;;
	4)
		require_root
		ensure_env_file
		change_port_interactive
		;;
	5) reset_account_password ;;
	6) show_status ;;
	0) exit 0 ;;
	*) die "无效选择。" ;;
	esac
}

case "${1:-menu}" in
install) install_app ;;
stop | close) close_app ;;
update) update_app ;;
port)
	require_root
	ensure_env_file
	change_port_interactive
	;;
reset-password | reset) reset_account_password ;;
status) show_status ;;
menu) main_menu ;;
*) die "未知命令：$1" ;;
esac
