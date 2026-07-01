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
MANAGER_DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/openstrmbridge-manager.sh"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
	COLOR_RESET=$'\033[0m'
	COLOR_BOLD=$'\033[1m'
	COLOR_DIM=$'\033[2m'
	COLOR_RED=$'\033[31m'
	COLOR_GREEN=$'\033[32m'
	COLOR_YELLOW=$'\033[33m'
	COLOR_CYAN=$'\033[36m'
else
	COLOR_RESET=""
	COLOR_BOLD=""
	COLOR_DIM=""
	COLOR_RED=""
	COLOR_GREEN=""
	COLOR_YELLOW=""
	COLOR_CYAN=""
fi

paint() {
	local color="$1"
	local text="$2"
	printf '%b%s%b' "$color" "$text" "$COLOR_RESET"
}

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

read_prompt() {
	local variable_name="$1"
	local prompt="$2"
	local value

	if { exec 3</dev/tty; } 2>/dev/null; then
		if read -r -p "$prompt" value <&3; then
			exec 3<&-
			value="${value%$'\r'}"
			printf -v "$variable_name" '%s' "$value"
			return
		fi

		exec 3<&-
	fi

	if ! read -r -p "$prompt" value; then
		die "无法读取输入。"
	fi
	value="${value%$'\r'}"

	printf -v "$variable_name" '%s' "$value"
}

read_secret_prompt() {
	local variable_name="$1"
	local prompt="$2"
	local value

	if { exec 3</dev/tty; } 2>/dev/null; then
		if read -r -s -p "$prompt" value <&3; then
			exec 3<&-
			value="${value%$'\r'}"
			printf '\n'
			printf -v "$variable_name" '%s' "$value"
			return
		fi

		exec 3<&-
		printf '\n'
	fi

	if ! read -r -s -p "$prompt" value; then
		printf '\n'
		die "无法读取输入。"
	fi
	printf '\n'
	value="${value%$'\r'}"

	printf -v "$variable_name" '%s' "$value"
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
	local port public_host
	port="$(read_env_value OPENSTRMBRIDGE_BACKEND_PORT "$DEFAULT_PORT")"
	public_host="$(format_url_host "$(detect_access_host "$DEFAULT_HOST")")"

	set_env_value OPENSTRMBRIDGE_BACKEND_HOST "$DEFAULT_HOST"
	set_env_value OPENSTRMBRIDGE_BACKEND_PORT "$port"
	set_env_value OPENSTRMBRIDGE_DATA_DIR "$INSTALL_DIR/data"
	set_env_value OPENSTRMBRIDGE_WEB_DIR "$INSTALL_DIR/dist"
	set_env_value OPENSTRMBRIDGE_GE2O_BINARY "$INSTALL_DIR/resources/bin/ge2o"
	set_env_value OPENSTRMBRIDGE_BACKEND_PUBLIC_URL "http://${public_host}:${port}"
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
	elif command -v curl >/dev/null 2>&1; then
		curl -fsSL "$MANAGER_DOWNLOAD_URL" -o "$MANAGER_BIN"
		chmod 755 "$MANAGER_BIN"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO "$MANAGER_BIN" "$MANAGER_DOWNLOAD_URL"
		chmod 755 "$MANAGER_BIN"
	fi
}

remove_install_dir() {
	case "$INSTALL_DIR" in
	"" | "/" | "/opt" | "/usr" | "/usr/local" | "/usr/local/bin" | "/etc")
		die "安装目录异常，拒绝删除：${INSTALL_DIR}"
		;;
	esac

	if [ -d "$INSTALL_DIR" ]; then
		rm -rf "$INSTALL_DIR"
	fi
}

systemd_available() {
	command -v systemctl >/dev/null 2>&1
}

is_installed() {
	[ -d "$INSTALL_DIR" ] &&
		[ -f "$INSTALL_DIR/server/storage-check-server.mjs" ] &&
		[ -x "$INSTALL_DIR/runtime/node/bin/node" ]
}

service_file_exists() {
	[ -f "$SERVICE_FILE" ]
}

get_service_active_state() {
	if ! systemd_available || ! service_file_exists; then
		printf 'unknown'
		return
	fi

	systemctl is-active "$SERVICE_NAME" 2>/dev/null || true
}

get_service_enabled_state() {
	if ! systemd_available || ! service_file_exists; then
		printf 'unknown'
		return
	fi

	systemctl is-enabled "$SERVICE_NAME" 2>/dev/null || true
}

detect_primary_ip() {
	local ip_addr

	if command -v ip >/dev/null 2>&1; then
		ip_addr="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }' || true)"

		if [ -n "$ip_addr" ]; then
			printf '%s' "$ip_addr"
			return
		fi
	fi

	if command -v hostname >/dev/null 2>&1; then
		ip_addr="$(hostname -I 2>/dev/null | awk 'NF { print $1; exit }' || true)"

		if [ -n "$ip_addr" ]; then
			printf '%s' "$ip_addr"
			return
		fi
	fi

	printf '127.0.0.1'
}

detect_access_host() {
	local bind_host="$1"

	case "$bind_host" in
	0.0.0.0 | "::" | "[::]" | "")
		detect_primary_ip
		;;
	*)
		printf '%s' "$bind_host"
		;;
	esac
}

format_url_host() {
	local host="$1"

	case "$host" in
	*:*)
		case "$host" in
		"["*"]") printf '%s' "$host" ;;
		*) printf '[%s]' "$host" ;;
		esac
		;;
	*) printf '%s' "$host" ;;
	esac
}

print_program_status() {
	local installed_label service_file_label active_state active_label enabled_state enabled_label bind_host port access_host url_host listen_label access_label

	if is_installed; then
		installed_label="$(paint "$COLOR_GREEN" "已安装")"
	else
		installed_label="$(paint "$COLOR_YELLOW" "未安装")"
	fi

	if service_file_exists; then
		service_file_label="$(paint "$COLOR_GREEN" "已创建")"
	else
		service_file_label="$(paint "$COLOR_YELLOW" "未创建")"
	fi

	active_state="$(get_service_active_state)"

	case "$active_state" in
	active) active_label="$(paint "$COLOR_GREEN" "已启动")" ;;
	failed) active_label="$(paint "$COLOR_RED" "异常停止")" ;;
	inactive | deactivating | unknown | "") active_label="$(paint "$COLOR_RED" "已停止")" ;;
	*) active_label="$(paint "$COLOR_YELLOW" "$active_state")" ;;
	esac

	enabled_state="$(get_service_enabled_state)"
	case "$enabled_state" in
	enabled) enabled_label="$(paint "$COLOR_GREEN" "已启用")" ;;
	disabled) enabled_label="$(paint "$COLOR_YELLOW" "未启用")" ;;
	unknown | "") enabled_label="$(paint "$COLOR_YELLOW" "未配置")" ;;
	*) enabled_label="$(paint "$COLOR_YELLOW" "$enabled_state")" ;;
	esac

	bind_host="$(read_env_value OPENSTRMBRIDGE_BACKEND_HOST "")"
	port="$(read_env_value OPENSTRMBRIDGE_BACKEND_PORT "")"

	if [ -n "$bind_host" ] && [ -n "$port" ]; then
		access_host="$(detect_access_host "$bind_host")"
		url_host="$(format_url_host "$access_host")"
		listen_label="${bind_host}:${port}"
		access_label="$(paint "$COLOR_CYAN" "http://${url_host}:${port}")"
	else
		listen_label="$(paint "$COLOR_YELLOW" "未配置")"
		access_label="$(paint "$COLOR_YELLOW" "未配置")"
	fi

	cat <<STATUS

$(paint "$COLOR_BOLD" "${APP_NAME} 状态")
安装状态：${installed_label}
服务文件：${service_file_label}
运行状态：${active_label}
开机启动：${enabled_label}
监听地址：${listen_label}
安装目录：${INSTALL_DIR}
配置文件：${ENV_FILE}
访问地址：${access_label}

STATUS
}

stop_service() {
	if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
		systemctl stop "$SERVICE_NAME" || true
	fi
}

start_service() {
	systemctl enable --now "$SERVICE_NAME"
}

start_app() {
	require_root

	if ! is_installed; then
		die "尚未安装 ${APP_NAME}。"
	fi

	ensure_env_file

	if ! service_file_exists; then
		write_service
	fi

	start_service
	info "服务已启动。"
	print_program_status
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
	local port="$1" public_host
	validate_port "$port" || die "端口无效：${port}"
	public_host="$(format_url_host "$(detect_access_host "$DEFAULT_HOST")")"

	set_env_value OPENSTRMBRIDGE_BACKEND_HOST "$DEFAULT_HOST"
	set_env_value OPENSTRMBRIDGE_BACKEND_PORT "$port"
	set_env_value OPENSTRMBRIDGE_BACKEND_PUBLIC_URL "http://${public_host}:${port}"
	systemctl daemon-reload
}

change_port_interactive() {
	local current_port port
	current_port="$(read_env_value OPENSTRMBRIDGE_BACKEND_PORT "$DEFAULT_PORT")"

	while true; do
		read_prompt port "请输入新的服务端口 [当前 ${current_port}]: "
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
		read_prompt username "请输入账号名称: "
		username="${username#"${username%%[![:space:]]*}"}"
		username="${username%"${username##*[![:space:]]}"}"

		if [ -n "$username" ]; then
			break
		fi

		warn "账号名称不能为空。"
	done

	while true; do
		read_secret_prompt password "请输入账号密码: "
		read_secret_prompt password_confirm "请再次输入账号密码: "

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
	read_prompt answer "是否更换默认端口 ${DEFAULT_PORT}？[y/N]: "

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
	print_program_status
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
	print_program_status
}

close_app() {
	require_root
	stop_service
	info "服务已关闭。"
	print_program_status
}

delete_app() {
	require_root

	print_program_status

	local confirm
	read_prompt confirm "删除将停止服务并移除安装目录、systemd 服务、环境文件和管理命令。请输入 DELETE 确认: "

	if [ "$confirm" != "DELETE" ]; then
		info "已取消删除。"
		return
	fi

	stop_service

	if systemd_available; then
		systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
	fi

	rm -f "$SERVICE_FILE"

	if systemd_available; then
		systemctl daemon-reload || true
		systemctl reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true
	fi

	remove_install_dir
	rm -f "$ENV_FILE"
	rm -f "$MANAGER_BIN"

	info "程序已删除。"
	print_program_status
}

print_menu() {
	cat <<MENU

$(paint "$COLOR_BOLD" "${APP_NAME} 管理脚本")
$(paint "$COLOR_CYAN" "1.") 安装 / 重装
$(paint "$COLOR_GREEN" "2.") 启动服务
$(paint "$COLOR_YELLOW" "3.") 关闭服务
$(paint "$COLOR_CYAN" "4.") 更新程序
$(paint "$COLOR_CYAN" "5.") 更换端口
$(paint "$COLOR_CYAN" "6.") 重置账号密码
$(paint "$COLOR_RED" "7.") 删除程序
$(paint "$COLOR_DIM" "0.") 退出

MENU
}

main_menu() {
	local choice
	print_program_status
	print_menu
	read_prompt choice "请选择功能: "

	case "$choice" in
	1) install_app ;;
	2) start_app ;;
	3) close_app ;;
	4) update_app ;;
	5)
		require_root
		ensure_env_file
		change_port_interactive
		;;
	6) reset_account_password ;;
	7) delete_app ;;
	0) exit 0 ;;
	*) die "无效选择。" ;;
	esac
}

case "${1:-menu}" in
install) install_app ;;
start) start_app ;;
stop | close) close_app ;;
update) update_app ;;
port)
	require_root
	ensure_env_file
	change_port_interactive
	;;
reset-password | reset) reset_account_password ;;
delete | uninstall | remove) delete_app ;;
menu) main_menu ;;
*) die "未知命令：$1" ;;
esac
