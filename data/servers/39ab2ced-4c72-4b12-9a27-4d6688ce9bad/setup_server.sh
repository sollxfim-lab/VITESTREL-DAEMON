#!/usr/bin/env bash
#==============================================================================
#  setup_server.sh  -  Server Provisioner  v3.0
#  Ubuntu / Debian  |  Idempotent  |  Modular  |  Interaktif
#
#  Modul:
#     1  Python Server        FastAPI, Uvicorn, Gunicorn, virtualenv
#     2  RDP + Tailscale      xRDP, XFCE4, akses selamat melalui VPN
#     3  Docker Engine        Docker CE dan Compose
#     4  Node.js LTS          Node, npm, pm2, yarn
#     5  Tailscale VPN        Rangkaian VPN mesh
#     6  Firewall (UFW)       Dasar selamat dan peraturan port
#     7  Dev Tools            git, tmux, zsh, neovim, ripgrep
#     8  Monitoring           Netdata
#     9  Mesin Maya (KVM)     Windows, Ubuntu, Debian, Rocky, AlmaLinux
#    10  Pterodactyl Wings    Daemon node untuk Pterodactyl Panel
#    11  Pterodactyl Panel    Panel web (nginx, PHP, MariaDB, Redis)
#    12  Cloudflare Tunnel    cloudflared dengan token tunnel
#    13  Mesh VPN lain        ZeroTier, NetBird
#
#  Penggunaan:
#     chmod +x setup_server.sh
#     ./setup_server.sh                  menu interaktif
#     ./setup_server.sh -m 3,10          terus pasang modul 3 dan 10
#     ./setup_server.sh -m all -y        semua modul, guna nilai lalai
#     ./setup_server.sh --help
#==============================================================================

set -Eeuo pipefail
shopt -u patsub_replacement 2>/dev/null || true

readonly APP_NAME="Server Provisioner"
readonly APP_VERSION="3.0"

# --- Identiti pengguna (menyokong ./skrip, sudo ./skrip dan root) -------------
REAL_USER="${SUDO_USER:-$(id -un)}"
REAL_HOME="$(getent passwd "$REAL_USER" 2>/dev/null | cut -d: -f6 || true)"
REAL_HOME="${REAL_HOME:-$HOME}"
REAL_GROUP="$(id -gn "$REAL_USER" 2>/dev/null || echo "$REAL_USER")"

# --- Konfigurasi (boleh ditimpa melalui environment) --------------------------
PROJECT_DIR="${PROJECT_DIR:-$REAL_HOME/server-project}"
STATE_DIR="${STATE_DIR:-$REAL_HOME/.server-provisioner}"
SERVER_PORT="${SERVER_PORT:-8000}"
VENV_DIR="${PROJECT_DIR}/venv"
LOG_FILE="${LOG_FILE:-$STATE_DIR/logs/setup_$(date +%Y%m%d_%H%M%S).log}"
TAILSCALE_CIDR="100.64.0.0/10"
RDP_PORT=3389

RUN_DIR=""          # direktori sementara (dicipta semasa mula)
CLI_MODULES=""      # nilai untuk --modules
ASSUME_YES=0        # 1 = guna nilai lalai, tiada soalan

usage() {
  cat <<'EOF'
Server Provisioner v3.0

Penggunaan:
  ./setup_server.sh [opsyen]

Opsyen:
  -m, --modules SENARAI   Jalankan modul terus tanpa menu. Contoh: 1,3,10  atau  1-4  atau  all
  -y, --yes               Terima nilai lalai (tidak interaktif)
      --no-color          Matikan warna
  -v, --version           Papar versi
  -h, --help              Papar bantuan ini

Pembolehubah environment:
  PROJECT_DIR   Direktori projek Python   (lalai: ~/server-project)
  STATE_DIR     Direktori log dan kelayakan (lalai: ~/.server-provisioner)
  SERVER_PORT   Port server Python         (lalai: 8000)
EOF
}

parse_args() {
  while (( $# )); do
    case "$1" in
      -m|--modules)
        if (( $# < 2 )); then echo "Opsyen $1 memerlukan nilai." >&2; exit 2; fi
        CLI_MODULES="$2"; shift 2 ;;
      -y|--yes)     ASSUME_YES=1; shift ;;
      --no-color)   NO_COLOR=1; export NO_COLOR; shift ;;
      -v|--version) echo "$APP_NAME $APP_VERSION"; exit 0 ;;
      -h|--help)    usage; exit 0 ;;
      *) echo "Opsyen tidak dikenali: $1 (guna --help)" >&2; exit 2 ;;
    esac
  done
}

#==============================================================================
#  UI: warna, kotak, soalan interaktif, pelaksana arahan dengan spinner
#  Tiada emoji. Penanda status menggunakan teks ASCII: [ OK ] [FAIL] [WARN].
#==============================================================================

UI_TTY=0
UI_UTF8=0
C_RST=''; C_BOLD=''; C_DIM=''; C_RED=''; C_GRN=''; C_YEL=''; C_BLU=''; C_CYN=''; C_GRY=''; C_WHT=''
BX_H='-'; BX_V='|'; BX_TL='+'; BX_TR='+'; BX_BL='+'; BX_BR='+'; BX_ML='+'; BX_MR='+'
SPIN_FRAMES=('|' '/' '-' '\')
TAG_OK='[ OK ]'; TAG_ERR='[FAIL]'; TAG_WRN='[WARN]'; TAG_INF='[INFO]'

ui_init() {
  UI_TTY=0
  if [[ -t 1 ]]; then UI_TTY=1; fi

  if (( UI_TTY )) && [[ -z "${NO_COLOR:-}" && "${TERM:-dumb}" != "dumb" ]]; then
    C_RST=$'\033[0m';  C_BOLD=$'\033[1m';       C_DIM=$'\033[2m'
    C_RED=$'\033[38;5;203m'; C_GRN=$'\033[38;5;114m'; C_YEL=$'\033[38;5;221m'
    C_BLU=$'\033[38;5;75m';  C_CYN=$'\033[38;5;80m';  C_GRY=$'\033[38;5;245m'
    C_WHT=$'\033[38;5;255m'
  fi

  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) UI_UTF8=1 ;;
  esac
  if (( UI_UTF8 )); then
    BX_H='─'; BX_V='│'; BX_TL='┌'; BX_TR='┐'; BX_BL='└'; BX_BR='┘'; BX_ML='├'; BX_MR='┤'
    SPIN_FRAMES=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  fi

  TAG_OK="${C_GRN}[ OK ]${C_RST}"
  TAG_ERR="${C_RED}[FAIL]${C_RST}"
  TAG_WRN="${C_YEL}[WARN]${C_RST}"
  TAG_INF="${C_BLU}[INFO]${C_RST}"
}

# --- Utiliti paparan -----------------------------------------------------------
repeat() {  # repeat <aksara> <bilangan>
  local s="" i
  for (( i = 0; i < $2; i++ )); do s+="$1"; done
  printf '%s' "$s"
}

strip_ansi() { sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g'; }

vis_len() {  # panjang boleh-lihat (tanpa kod warna)
  local s
  s="$(printf '%s' "$1" | strip_ansi)"
  printf '%d' "${#s}"
}

ok()   { printf '  %s  %s\n' "$TAG_OK"  "$*"; }
err()  { printf '  %s  %s\n' "$TAG_ERR" "$*" >&2; }
warn() { printf '  %s  %s\n' "$TAG_WRN" "$*"; }
info() { printf '  %s  %s\n' "$TAG_INF" "$*"; }
note() { printf '  %s%s%s\n' "$C_GRY" "$*" "$C_RST"; }
step() { printf '\n  %s==>%s %s%s%s\n' "$C_CYN" "$C_RST" "$C_BOLD" "$*" "$C_RST"; }
rule() { printf '  %s%s%s\n' "$C_GRY" "$(repeat "$BX_H" "${1:-60}")" "$C_RST"; }

hdr() {  # hdr "MODUL 1" "Python Server"
  printf '\n  %s%s  |  %s%s\n' "$C_BOLD$C_BLU" "$1" "$2" "$C_RST"
  rule 62
}

die()         { err "$*"; exit 1; }
skip_module() { warn "$*"; exit 10; }

# ui_box "TAJUK" <warna-sempadan> baris...   ("---" = garis pemisah)
ui_box() {
  local title="$1" bc="$2"; shift 2
  local -a lines=("$@")
  local w=$(( ${#title} + 4 )) l n pad
  for l in "${lines[@]}"; do
    if [[ "$l" != "---" ]]; then
      n="$(vis_len "$l")"
      if (( n + 2 > w )); then w=$(( n + 2 )); fi
    fi
  done
  if (( w < 56 )); then w=56; fi

  printf '  %s%s%s\n' "$bc" "${BX_TL}${BX_H} ${C_BOLD}${title}${C_RST}${bc} $(repeat "$BX_H" $(( w - ${#title} - 3 )))${BX_TR}" "$C_RST"
  for l in "${lines[@]}"; do
    if [[ "$l" == "---" ]]; then
      printf '  %s%s%s\n' "$bc" "${BX_ML}$(repeat "$BX_H" "$w")${BX_MR}" "$C_RST"
    else
      n="$(vis_len "$l")"
      pad=$(( w - 2 - n ))
      printf '  %s%s%s %s%*s %s%s%s\n' "$bc" "$BX_V" "$C_RST" "$l" "$pad" "" "$bc" "$BX_V" "$C_RST"
    fi
  done
  printf '  %s%s%s\n' "$bc" "${BX_BL}$(repeat "$BX_H" "$w")${BX_BR}" "$C_RST"
}

kv() {  # kv "Label" "nilai"  -> baris berformat untuk ui_box
  printf '%s%-12s%s %s' "$C_GRY" "$1" "$C_RST" "$2"
}

# --- Soalan interaktif (prompt ke stderr, nilai ke stdout) --------------------------
_prompt() {
  printf '  %s>%s %s%s%s' "$C_CYN" "$C_RST" "$C_BOLD" "$1" "$C_RST" >&2
  if [[ -n "${2:-}" ]]; then printf ' %s[%s]%s' "$C_GRY" "$2" "$C_RST" >&2; fi
  printf ': ' >&2
}

ask() {  # ask "Soalan" "lalai"
  local val=""
  if (( ASSUME_YES )); then printf '%s' "${2:-}"; return 0; fi
  _prompt "$1" "${2:-}"
  IFS= read -r val || val=""
  printf '%s' "${val:-${2:-}}"
}

ask_secret() {  # ask_secret "Soalan"   (input tersembunyi)
  local val=""
  if (( ASSUME_YES )); then return 0; fi
  _prompt "$1" ""
  IFS= read -rs val || val=""
  printf '\n' >&2
  printf '%s' "$val"
}

ask_yn() {  # ask_yn "Soalan" y|n   -> status 0 = ya
  local q="$1" def="${2:-y}" hint ans
  if (( ASSUME_YES )); then [[ "$def" == "y" ]]; return; fi
  if [[ "$def" == "y" ]]; then hint="Y/n"; else hint="y/N"; fi
  while true; do
    _prompt "$q" "$hint"
    IFS= read -r ans || ans=""
    ans="${ans:-$def}"
    case "${ans,,}" in
      y|ya|yes) return 0 ;;
      n|no|tidak) return 1 ;;
    esac
    warn "Jawab y atau n."
  done
}

CHOICE=0
ask_choice() {  # ask_choice "Tajuk" <lalai> item1 item2 ...   -> CHOICE (1..n), 0 = batal (status 1)
  local title="$1" def="$2"; shift 2
  local -a items=("$@")
  local i n=${#items[@]} ans
  printf '\n  %s%s%s\n' "$C_BOLD" "$title" "$C_RST"
  for (( i = 0; i < n; i++ )); do
    printf '    %s%2d%s  %s\n' "$C_CYN" $(( i + 1 )) "$C_RST" "${items[i]}"
  done
  printf '    %s%2d%s  %sBatal / kembali%s\n' "$C_GRY" 0 "$C_RST" "$C_GRY" "$C_RST"
  while true; do
    ans="$(ask "Pilihan" "$def")"
    if [[ "$ans" =~ ^[0-9]+$ ]] && (( ans <= n )); then
      CHOICE=$ans
      if (( ans == 0 )); then return 1; fi
      return 0
    fi
    warn "Pilihan tidak sah."
  done
}

# --- Pelaksana arahan: output ke log, paparan ringkas dengan spinner --------------------
now_ms() { date +%s%3N; }

fmt_elapsed() {
  local ms=$1
  if (( ms >= 60000 )); then
    printf '%dm %ds' $(( ms / 60000 )) $(( (ms % 60000) / 1000 ))
  else
    printf '%d.%ds' $(( ms / 1000 )) $(( (ms % 1000) / 100 ))
  fi
}

spinner_wait() {  # spinner_wait <pid> "mesej"
  local pid="$1" msg="$2" i=0 n=${#SPIN_FRAMES[@]}
  while kill -0 "$pid" 2>/dev/null; do
    printf '\r  %s%s%s  %s' "$C_CYN" "${SPIN_FRAMES[i % n]}" "$C_RST" "$msg"
    i=$(( i + 1 ))
    sleep 0.1
  done
  printf '\r\033[K'
}

RUN_PID=""
_run_core() {  # _run_core fatal|soft "mesej" arahan...
  local mode="$1" msg="$2"; shift 2
  local t0 rc=0 el off shown="$*"
  if [[ "${RUN_REDACT:-0}" == "1" ]]; then shown="(arahan disembunyikan)"; fi
  t0="$(now_ms)"
  printf '\n[%s] %s\n$ %s\n' "$(date '+%F %T')" "$msg" "$shown" >>"$LOG_FILE"
  off="$(wc -c <"$LOG_FILE")"

  if (( UI_TTY )); then
    "$@" >>"$LOG_FILE" 2>&1 </dev/null &
    RUN_PID=$!
    spinner_wait "$RUN_PID" "$msg"
    wait "$RUN_PID" || rc=$?
    RUN_PID=""
  else
    "$@" >>"$LOG_FILE" 2>&1 </dev/null || rc=$?
  fi

  el=$(( $(now_ms) - t0 ))
  if (( rc == 0 )); then
    printf '  %s  %s %s(%s)%s\n' "$TAG_OK" "$msg" "$C_GRY" "$(fmt_elapsed "$el")" "$C_RST"
    return 0
  fi
  if [[ "$mode" == "soft" ]]; then
    printf '  %s  %s (kod %s)\n' "$TAG_WRN" "$msg" "$rc"
  else
    printf '  %s  %s (kod %s)\n' "$TAG_ERR" "$msg" "$rc" >&2
    tail -c "+$(( off + 1 ))" "$LOG_FILE" | tail -n 12 | sed 's/^/        /' >&2
    printf '  %sLog penuh: %s%s\n' "$C_GRY" "$LOG_FILE" "$C_RST" >&2
  fi
  return "$rc"
}

run() { _run_core fatal "$@" || exit 1; }   # gagal = hentikan modul
try() { _run_core soft "$@"; }               # gagal = amaran, kembalikan status

# --- Pengendali isyarat / ralat -------------------------------------------------------
on_interrupt() {
  if [[ -n "${RUN_PID:-}" ]]; then kill "$RUN_PID" 2>/dev/null || true; fi
  printf '\n' >&2
  warn "Dibatalkan oleh pengguna."
  exit 130
}

on_err() {  # on_err <baris> <arahan>
  err "Ralat tidak dijangka pada baris $1: $2"
}

#==============================================================================
#  Pembantu sistem
#==============================================================================

# Jika dijalankan sebagai root, 'sudo' dimulakan sebagai pembungkus ringkas
# supaya skrip berfungsi pada VPS minimum yang tidak memasang sudo.
if (( EUID == 0 )); then
  sudo() {
    local run_user=""
    while (( $# )); do
      case "$1" in
        -u)           run_user="$2"; shift 2 ;;
        --)           shift; break ;;
        -E|-n|-H|-S|-k|-i) shift ;;
        *)            break ;;
      esac
    done
    if [[ -n "$run_user" ]]; then
      runuser -u "$run_user" -- env "$@"
    else
      env "$@"
    fi
  }
  export -f sudo
fi

command_exists() { command -v "$1" >/dev/null 2>&1; }

SUDO_KEEPALIVE_PID=""
ensure_privileges() {
  if (( EUID == 0 )); then return 0; fi
  command_exists sudo || die "sudo tidak dijumpai. Jalankan sebagai root atau pasang sudo."
  if ! sudo -n true 2>/dev/null; then
    info "Kata laluan sudo diperlukan."
    sudo -v || die "Akses sudo ditolak."
  fi
  ( while true; do
      sudo -n true 2>/dev/null || exit 0
      sleep 50
      kill -0 "$$" 2>/dev/null || exit 0
    done ) &
  SUDO_KEEPALIVE_PID=$!
}

fix_owner() {  # serahkan fail kepada pengguna sebenar apabila dijalankan sebagai root
  if (( EUID == 0 )) && [[ "$REAL_USER" != "root" ]]; then
    chown -R "$REAL_USER:$REAL_GROUP" "$@" 2>/dev/null || true
  fi
}

as_user() {  # jalankan arahan sebagai pengguna sebenar
  if [[ "$(id -un)" == "$REAL_USER" ]]; then "$@"; else sudo -u "$REAL_USER" "$@"; fi
}

put_file() {  # put_file <laluan> [mod]   (kandungan dari stdin, ditulis sebagai root)
  local path="$1" mode="${2:-644}"
  sudo tee "$path" >/dev/null
  sudo chmod "$mode" "$path"
}

# --- apt -------------------------------------------------------------------------------
apt_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }

apt_available() {
  local c
  c="$(apt-cache policy "$1" 2>/dev/null | awk '/Candidate:/ {print $2}')"
  [[ -n "$c" && "$c" != "(none)" ]]
}

apt_refresh_once() {
  if [[ -f "$RUN_DIR/.apt_updated" ]]; then return 0; fi
  run "Mengemas kini indeks pakej" sudo apt-get update -qq
  touch "$RUN_DIR/.apt_updated"
}

apt_install() {  # hanya memasang pakej yang belum ada
  local -a missing=()
  local p label
  for p in "$@"; do
    if ! apt_installed "$p"; then missing+=("$p"); fi
  done
  if (( ${#missing[@]} == 0 )); then
    if (( $# <= 4 )); then ok "Sudah dipasang: $*"; else ok "Semua $# pakej sudah dipasang"; fi
    return 0
  fi
  apt_refresh_once
  label="Memasang ${#missing[@]} pakej"
  if (( ${#missing[@]} <= 4 )); then label+=": ${missing[*]}"; fi
  run "$label" sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
      apt-get install -y -qq "${missing[@]}"
}

apt_install_optional() {  # langkau pakej yang tiada dalam repositori distro ini
  local -a avail=()
  local p
  apt_refresh_once
  for p in "$@"; do
    if apt_available "$p"; then avail+=("$p"); else note "Tiada dalam repositori: $p"; fi
  done
  if (( ${#avail[@]} )); then apt_install "${avail[@]}"; fi
}

# --- Rangkaian ---------------------------------------------------------------------------
host_ip() {
  local addr
  addr="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
  if [[ -z "$addr" ]]; then addr="$(hostname -I 2>/dev/null | awk '{print $1}')"; fi
  printf '%s' "${addr:-IP-SERVER}"
}

public_ip() {
  local u addr=""
  for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    addr="$(curl -fsS --max-time 5 "$u" 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ "$addr" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then printf '%s' "$addr"; return 0; fi
  done
  return 1
}

port_in_use() { ss -H -ltn "sport = :$1" 2>/dev/null | grep -q .; }

valid_fqdn() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]; }

dns_check_confirm() {  # dns_check_confirm <fqdn>  -> status 0 = teruskan
  local fqdn="$1" resolved pub
  resolved="$(getent ahostsv4 "$fqdn" 2>/dev/null | awk '{print $1; exit}')"
  pub="$(public_ip || true)"
  if [[ -z "$resolved" ]]; then
    warn "DNS untuk $fqdn belum diselesaikan. Tambah rekod A yang menuju ke IP pelayan ini."
    ask_yn "Teruskan juga?" n
    return
  elif [[ -n "$pub" && "$resolved" != "$pub" ]]; then
    warn "$fqdn menuju ke $resolved, tetapi IP awam pelayan ini ialah $pub."
    ask_yn "Teruskan juga? (gagal jika DNS salah atau melalui proksi seperti Cloudflare)" n
    return
  fi
  ok "DNS sepadan: $fqdn -> $resolved"
}

tcp_probe_file() {  # tcp_probe_file <hos> <port> <had-saat>
  local host="$1" port="$2" timeout="${3:-90}" deadline
  deadline=$(( $(date +%s) + timeout ))
  while (( $(date +%s) < deadline )); do
    if timeout 2 bash -c ">/dev/tcp/${host}/${port}" 2>/dev/null; then return 0; fi
    sleep 3
  done
  return 1
}

# --- Fail konfigurasi INI: ini_set <fail> <seksyen> <kunci> <nilai> ---------------------------
ini_set() {
  local f="$1" s="$2" k="$3" v="$4" tmp
  tmp="$(mktemp)"
  sudo touch "$f"
  sudo cat "$f" | awk -v sec="[$s]" -v key="$k" -v val="$v" '
    BEGIN { insec = 0; done = 0 }
    /^\[/ { if (insec && !done) { print "    " key " = " val; done = 1 } insec = ($0 == sec) }
    insec && $0 ~ ("^[ \t]*" key "[ \t]*=") { if (!done) { print "    " key " = " val; done = 1 } next }
    { print }
    END { if (!done) { if (!insec) print sec; print "    " key " = " val } }
  ' >"$tmp"
  sudo install -m 644 "$tmp" "$f"
  rm -f "$tmp"
}

# --- Kata laluan ----------------------------------------------------------------------------
PW_SYMBOLS='!@#%^&*_+=-'

rand_chars() {  # rand_chars <set-aksara> <bilangan>   (selamat dengan pipefail)
  local set="$1" n="$2" out="" chunk
  while (( ${#out} < n )); do
    chunk="$(head -c 256 /dev/urandom | LC_ALL=C tr -dc "$set" || true)"
    out+="$chunk"
  done
  printf '%s' "${out:0:n}"
}

# Dasar: min 8 aksara dan sekurang-kurangnya 3 daripada 4 kelas aksara
check_password_policy() {
  local p="$1" cls=0
  if (( ${#p} < 8 )); then return 1; fi
  if [[ "$p" =~ [a-z] ]]; then cls=$(( cls + 1 )); fi
  if [[ "$p" =~ [A-Z] ]]; then cls=$(( cls + 1 )); fi
  if [[ "$p" =~ [0-9] ]]; then cls=$(( cls + 1 )); fi
  if [[ "$p" =~ [^A-Za-z0-9] ]]; then cls=$(( cls + 1 )); fi
  (( cls >= 3 ))
}

password_classes() {
  local p="$1" cls=0
  if [[ "$p" =~ [a-z] ]]; then cls=$(( cls + 1 )); fi
  if [[ "$p" =~ [A-Z] ]]; then cls=$(( cls + 1 )); fi
  if [[ "$p" =~ [0-9] ]]; then cls=$(( cls + 1 )); fi
  if [[ "$p" =~ [^A-Za-z0-9] ]]; then cls=$(( cls + 1 )); fi
  printf '%d' "$cls"
}

strengthen_password() {
  local p="$1"
  while (( ${#p} < 8 )); do p+="$(rand_chars 'abcdefghjkmnpqrstuvwxyz' 1)"; done
  if ! [[ "$p" =~ [A-Z] ]];        then p+="$(rand_chars 'ABCDEFGHJKLMNPQRSTUVWXYZ' 2)"; fi
  if ! [[ "$p" =~ [0-9] ]];        then p+="$(rand_chars '23456789' 2)"; fi
  if ! [[ "$p" =~ [^A-Za-z0-9] ]]; then p+="$(rand_chars "$PW_SYMBOLS" 2)"; fi
  printf '%s' "$p"
}

gen_strong_password() {
  local raw
  raw="$(rand_chars 'abcdefghjkmnpqrstuvwxyz' 6)$(rand_chars 'ABCDEFGHJKLMNPQRSTUVWXYZ' 4)$(rand_chars '23456789' 4)$(rand_chars "$PW_SYMBOLS" 2)"
  printf '%s' "$raw" | fold -w1 | shuf | tr -d '\n'
}

# --- Firewall (UFW) ----------------------------------------------------------------------------
fw_allow() {  # fw_allow <peraturan> [komen]   - hanya jika ufw dipasang
  command_exists ufw || return 0
  sudo ufw allow "$1" comment "${2:-provisioner}" >>"$LOG_FILE" 2>&1 || true
}

fw_ssh_ports() {
  local -a ports=()
  mapfile -t ports < <(sudo sshd -T 2>/dev/null | awk '$1 == "port" {print $2}')
  if [[ -n "${SSH_CONNECTION:-}" ]]; then ports+=("${SSH_CONNECTION##* }"); fi
  if (( ${#ports[@]} == 0 )); then ports=(22); fi
  printf '%s\n' "${ports[@]}" | sort -un
}

fw_ensure_base() {  # pasang ufw, benarkan SSH dahulu, kemudian tetapkan dasar lalai
  local p
  apt_install ufw
  while read -r p; do
    if [[ -n "$p" ]]; then sudo ufw allow "${p}/tcp" comment "SSH" >>"$LOG_FILE" 2>&1 || true; fi
  done < <(fw_ssh_ports)
  sudo ufw default deny incoming  >>"$LOG_FILE" 2>&1
  sudo ufw default allow outgoing >>"$LOG_FILE" 2>&1
}

fw_enable() { sudo ufw --force enable >>"$LOG_FILE" 2>&1; }

# --- Tailscale -----------------------------------------------------------------------------------
tailscale_install() {
  if command_exists tailscale; then
    ok "Tailscale sudah dipasang ($(tailscale version 2>/dev/null | head -n1))"
    return 0
  fi
  run "Memuat turun pemasang Tailscale" curl -fsSL https://tailscale.com/install.sh -o "$RUN_DIR/tailscale-install.sh"
  run "Memasang Tailscale" sudo sh "$RUN_DIR/tailscale-install.sh"
  run "Mengaktifkan tailscaled" sudo systemctl enable --now tailscaled
}

sanitize_hostname() {
  local h
  h="$(printf '%s' "$1" | tr -cs 'A-Za-z0-9-' '-' | tr '[:upper:]' '[:lower:]')"
  h="${h:0:63}"
  h="${h#-}"; h="${h%-}"
  printf '%s' "${h:-node}"
}

tailscale_connect() {  # tailscale_connect <authkey> <nama-hos>  -> status 0 = berjaya
  local key="$1" host="$2" kf="$RUN_DIR/ts.key"
  ( umask 077; printf '%s' "$key" >"$kf" )
  # Kunci dihantar melalui fail supaya tidak muncul dalam senarai proses atau log.
  if try "Menyambung ke tailnet sebagai '$host'" \
       sudo tailscale up --auth-key="file:$kf" --hostname="$host" --accept-dns=false; then
    rm -f "$kf"; return 0
  fi
  rm -f "$kf"; return 1
}

wait_ts_ip() {  # wait_ts_ip <fail-output> <had-saat>
  local out="$1" timeout="${2:-180}" deadline addr
  deadline=$(( $(date +%s) + timeout ))
  while (( $(date +%s) < deadline )); do
    addr="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
    if [[ -n "$addr" ]]; then printf '%s' "$addr" >"$out"; return 0; fi
    sleep 3
  done
  return 1
}

tailscale_ip_now() { tailscale ip -4 2>/dev/null | head -n1 || true; }

# --- Docker ---------------------------------------------------------------------------------------
docker_ensure() {
  if command_exists docker; then
    ok "Docker sudah dipasang ($(docker --version 2>/dev/null | cut -d, -f1))"
  else
    run "Memuat turun pemasang Docker" curl -fsSL https://get.docker.com -o "$RUN_DIR/get-docker.sh"
    if ! try "Memasang Docker Engine (pemasang rasmi)" sudo sh "$RUN_DIR/get-docker.sh"; then
      warn "Pemasang rasmi gagal; mencuba pakej docker.io dari repositori distro."
      apt_install docker.io
    fi
  fi
  run "Mengaktifkan perkhidmatan Docker" sudo systemctl enable --now docker
}

# --- Pengasingan: jalankan fungsi dalam subshell dengan errexit aktif ------------------------------
# Kod keluar disimpan dalam ISO_RC (fungsi ini sentiasa return 0 supaya skrip induk tidak terhenti).
ISO_RC=0
isolate() {
  local saved
  saved="$(trap -p ERR)"
  trap - ERR
  set +e
  ( trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR; set -e; "$@" )
  ISO_RC=$?
  set -e
  if [[ -n "$saved" ]]; then eval "$saved"; fi
  return 0
}

# --- Runtime: log, direktori sementara, pembersihan -------------------------------------------------
init_runtime() {
  RUN_DIR="$(mktemp -d /tmp/provisioner.XXXXXX)"
  mkdir -p "$STATE_DIR/credentials" "$(dirname "$LOG_FILE")"
  chmod 700 "$STATE_DIR" "$STATE_DIR/credentials"
  : >"$LOG_FILE"
  chmod 600 "$LOG_FILE"
  fix_owner "$STATE_DIR"
  printf '%s %s - %s\n' "$APP_NAME" "$APP_VERSION" "$(date '+%F %T')" >>"$LOG_FILE"
}

cleanup() {
  if [[ -n "${SUDO_KEEPALIVE_PID:-}" ]]; then kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true; fi
  if [[ -n "${RUN_DIR:-}" && -d "$RUN_DIR" ]]; then rm -rf "$RUN_DIR"; fi
  return 0
}

#==============================================================================
#  MODUL: Python, RDP, Docker, Node.js, Tailscale
#==============================================================================

# ------------------------------------------------------------------------------
#  Python Server
# ------------------------------------------------------------------------------
module_python() {
  hdr "MODUL $(mod_no python)" "Python Server"

  step "Pakej sistem"
  apt_install python3 python3-pip python3-venv python3-dev

  step "Struktur projek"
  mkdir -p "$PROJECT_DIR"/{app,static,templates,tests,logs}
  ok "Direktori projek: $PROJECT_DIR"

  step "Persekitaran Python"
  if [[ -x "$VENV_DIR/bin/python" ]]; then
    ok "Virtualenv sedia ada"
  else
    run "Membuat virtualenv" python3 -m venv "$VENV_DIR"
  fi
  run "Mengemas kini pip, wheel, setuptools" "$VENV_DIR/bin/pip" install -q --upgrade pip wheel setuptools

  cat >"$PROJECT_DIR/requirements.txt" <<'REQS'
fastapi
uvicorn[standard]
gunicorn
pydantic
python-dotenv
httpx
aiohttp
requests
websockets
sqlalchemy
python-multipart
orjson
rich
typer
loguru
black
ruff
isort
mypy
pytest
pytest-asyncio
REQS
  run "Memasang $(grep -c . "$PROJECT_DIR/requirements.txt") pakej Python" \
      "$VENV_DIR/bin/pip" install -q -r "$PROJECT_DIR/requirements.txt"

  step "Kerangka aplikasi FastAPI"
  touch "$PROJECT_DIR/app/__init__.py"

  cat >"$PROJECT_DIR/app/main.py" <<'PY'
"""Titik masuk FastAPI. Dijana oleh setup_server.sh."""
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
STARTED = time.time()

app = FastAPI(title="Server API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def timing(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Process-Time-Ms"] = f"{(time.perf_counter() - t0) * 1000:.2f}"
    return response


@app.get("/")
async def index():
    page = STATIC_DIR / "index.html"
    if page.exists():
        return FileResponse(page)
    return {"status": "online"}


@app.get("/health")
async def health():
    return {"status": "ok", "uptime_seconds": round(time.time() - STARTED, 2)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("ENV", "development") == "development",
    )
PY

  cat >"$PROJECT_DIR/tests/test_health.py" <<'PY'
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
PY

  cat >"$PROJECT_DIR/pytest.ini" <<'INI'
[pytest]
pythonpath = .
testpaths = tests
INI

  cat >"$PROJECT_DIR/static/index.html" <<'HTML'
<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Server Online</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #0d1117; color: #e6edf3;
         font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  main { border: 1px solid #263040; border-radius: 10px; padding: 2rem 2.75rem; background: #111923; }
  h1 { margin: 0 0 .35rem; font-size: 1.05rem; font-weight: 600; letter-spacing: .02em; }
  h1::before { content: ""; display: inline-block; width: 9px; height: 9px; margin-right: .6rem;
               border-radius: 50%; background: #3fb950; box-shadow: 0 0 0 3px #3fb95033; }
  p { margin: 0; color: #8b98a5; font-size: .85rem; }
  a { color: #58a6ff; text-decoration: none; }
</style>
</head>
<body>
<main>
  <h1>Server dalam talian</h1>
  <p>FastAPI + Uvicorn. Semak <a href="/health">/health</a> dan <a href="/docs">/docs</a>.</p>
</main>
</body>
</html>
HTML

  cat >"$PROJECT_DIR/.env.example" <<'ENV'
HOST=0.0.0.0
PORT=8000
ENV=development
CORS_ORIGINS=*
ENV
  if [[ ! -f "$PROJECT_DIR/.env" ]]; then cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"; fi

  cat >"$PROJECT_DIR/.gitignore" <<'GIT'
venv/
__pycache__/
*.pyc
.env
logs/
.pytest_cache/
GIT
  fix_owner "$PROJECT_DIR"
  ok "Kerangka ditulis: app/main.py, static/index.html, tests/, .env"

  step "Pengesahan"
  try "Menjalankan ujian asas (pytest)" bash -c "cd '$PROJECT_DIR' && '$VENV_DIR/bin/python' -m pytest -q" || true

  if ask_yn "Pasang sebagai perkhidmatan systemd (auto-mula semasa boot)?" n; then
    put_file /etc/systemd/system/pyserver.service 644 <<EOF
[Unit]
Description=FastAPI server (${PROJECT_DIR})
After=network.target

[Service]
Type=simple
User=${REAL_USER}
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=-${PROJECT_DIR}/.env
ExecStart=${VENV_DIR}/bin/gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:${SERVER_PORT} --access-logfile ${PROJECT_DIR}/logs/access.log --error-logfile ${PROJECT_DIR}/logs/error.log
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
    run "Mengaktifkan perkhidmatan pyserver" bash -c "sudo systemctl daemon-reload && sudo systemctl enable --now pyserver"
    fw_allow "${SERVER_PORT}/tcp" "Python server"
    ok "Perkhidmatan aktif pada port ${SERVER_PORT}  (systemctl status pyserver)"
  else
    note "Jalankan manual: cd $PROJECT_DIR && venv/bin/python -m app.main"
  fi
}

# ------------------------------------------------------------------------------
#  RDP + Tailscale  (xRDP + XFCE4; port 3389 hanya melalui Tailscale)
# ------------------------------------------------------------------------------
rdp_deploy_payload() {  # rdp_deploy_payload <url> <pengguna>
  local url="$1" user="$2" dir file head5 sum plog
  if ! [[ "$url" =~ ^https?:// ]]; then warn "URL tidak sah; skrip bootstrap dilangkau."; return 0; fi
  dir="$(mktemp -d /tmp/rdp-bootstrap.XXXXXX)"
  chmod 755 "$dir"
  file="$dir/bootstrap.sh"
  if ! try "Memuat turun skrip bootstrap" curl -fsSL --max-redirs 5 --max-time 60 -o "$file" "$url"; then
    return 0
  fi
  if [[ ! -s "$file" ]]; then warn "Skrip kosong; dilangkau."; return 0; fi
  head5="$(head -n 5 "$file")"
  if grep -qiE '<!doctype|<html|<title|sign_in' <<<"$head5"; then
    warn "Kandungan ialah halaman HTML, bukan skrip. Semak URL dan akses repositori."
    return 0
  fi
  sum="$(sha256sum "$file" | awk '{print $1}')"
  note "SHA256: $sum  ($(wc -c <"$file") bait)"
  if ! ask_yn "Jalankan skrip ini sebagai '$user'?" n; then note "Skrip tidak dijalankan."; return 0; fi
  chmod 755 "$file"
  plog="/tmp/rdp-payload-$$.log"
  : >"$plog"
  sudo chown "$user" "$plog"
  sudo -u "$user" nohup bash -c 'bash "$1" >"$2" 2>&1' _ "$file" "$plog" >/dev/null 2>&1 &
  ok "Skrip dijalankan di latar belakang (log: $plog)"
}

module_rdp() {
  local rdp_user rdp_pass final_pass ts_key ts_host payload home cred
  local strengthened=0 give_sudo=0 ts_ip="" alive=0

  hdr "MODUL $(mod_no rdp)" "RDP + Tailscale"
  note "Port ${RDP_PORT} hanya dibuka kepada rangkaian Tailscale. Akses dari internet disekat."

  rdp_user="$(ask "Nama pengguna RDP" "rdpuser")"
  if ! [[ "$rdp_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
    die "Nama pengguna tidak sah (huruf kecil, nombor, _ dan - sahaja)."
  fi
  rdp_pass="$(ask_secret "Kata laluan RDP (kosong = jana automatik)")"
  if [[ -z "$rdp_pass" ]]; then rdp_pass="$(gen_strong_password)"; note "Kata laluan dijana secara automatik."; fi
  ts_key="$(ask_secret "Tailscale auth key (tskey-...; kosong = sambung manual)")"
  if [[ -n "$ts_key" && "$ts_key" != tskey-* ]]; then
    warn "Auth key tidak bermula dengan 'tskey-'. Pastikan ia dari konsol admin Tailscale."
  fi
  ts_host="$(sanitize_hostname "$(ask "Nama hos Tailscale" "rdp-$(hostname -s)")")"
  payload="$(ask "URL skrip bootstrap pilihan (kosong = langkau)" "")"
  if ask_yn "Beri akses sudo kepada '$rdp_user'?" y; then give_sudo=1; fi

  step "1/8  Dasar kata laluan"
  final_pass="$rdp_pass"
  if ! check_password_policy "$final_pass"; then
    final_pass="$(strengthen_password "$final_pass")"
    strengthened=1
    warn "Kata laluan tidak memenuhi dasar; diperkuatkan secara automatik."
  fi
  ok "Dasar dipenuhi: panjang ${#final_pass}, kelas aksara $(password_classes "$final_pass")/4"

  step "2/8  Pakej desktop"
  apt_install xrdp xorgxrdp xfce4 xfce4-goodies xfce4-terminal dbus-x11 x11-xserver-utils mousepad fonts-dejavu-core

  step "3/8  Konfigurasi xRDP"
  printf 'startxfce4\n' | put_file /etc/skel/.xsession 644
  run "Menambah xrdp ke kumpulan ssl-cert" sudo usermod -aG ssl-cert xrdp
  sudo mkdir -p /etc/polkit-1/localauthority/50-local.d /etc/polkit-1/rules.d
  # Elak dialog "Authentication is required to create a color managed device"
  put_file /etc/polkit-1/localauthority/50-local.d/45-allow-colord.pkla 644 <<'POLKIT'
[Allow Colord for all users]
Identity=unix-user:*
Action=org.freedesktop.color-manager.create-device;org.freedesktop.color-manager.create-profile;org.freedesktop.color-manager.delete-device;org.freedesktop.color-manager.delete-profile;org.freedesktop.color-manager.modify-device;org.freedesktop.color-manager.modify-profile
ResultAny=no
ResultInactive=no
ResultActive=yes
POLKIT
  put_file /etc/polkit-1/rules.d/45-allow-colord.rules 644 <<'RULES'
polkit.addRule(function(action, subject) {
    if (action.id.indexOf("org.freedesktop.color-manager.") === 0) {
        return polkit.Result.YES;
    }
});
RULES
  run "Mengaktifkan xRDP" sudo systemctl enable --now xrdp
  run "Memulakan semula xRDP" sudo systemctl restart xrdp

  step "4/8  Pengguna RDP"
  if id "$rdp_user" >/dev/null 2>&1; then
    warn "Pengguna '$rdp_user' sudah wujud; kata laluan dikemas kini."
  else
    run "Mencipta pengguna '$rdp_user'" sudo useradd -m -s /bin/bash -c "RDP user" "$rdp_user"
  fi
  printf '%s:%s\n' "$rdp_user" "$final_pass" | sudo chpasswd
  sudo usermod -aG ssl-cert "$rdp_user"
  if (( give_sudo )); then sudo usermod -aG sudo "$rdp_user"; fi
  home="$(getent passwd "$rdp_user" | cut -d: -f6)"
  printf 'startxfce4\n' | sudo -u "$rdp_user" tee "$home/.xsession" >/dev/null
  ok "Pengguna '$rdp_user' sedia (sesi XFCE4)"

  step "5/8  Tailscale"
  tailscale_install
  if [[ -n "$ts_key" ]]; then
    if tailscale_connect "$ts_key" "$ts_host"; then
      rm -f "$RUN_DIR/tsip"
      try "Menunggu alamat IP Tailscale" wait_ts_ip "$RUN_DIR/tsip" 180 || true
      if [[ -s "$RUN_DIR/tsip" ]]; then ts_ip="$(<"$RUN_DIR/tsip")"; ok "Node '$ts_host' aktif: $ts_ip"; fi
    else
      warn "Gagal menyambung. Cuba manual: sudo tailscale up --hostname $ts_host"
    fi
  else
    note "Tiada auth key. Sambung manual: sudo tailscale up --hostname $ts_host"
  fi
  if [[ -z "$ts_ip" ]]; then ts_ip="$(tailscale_ip_now)"; fi

  step "6/8  Firewall"
  fw_ensure_base
  sudo ufw allow in on tailscale0 to any port "$RDP_PORT" proto tcp comment "RDP via Tailscale (antara muka)" >>"$LOG_FILE" 2>&1 || true
  sudo ufw allow from "$TAILSCALE_CIDR" to any port "$RDP_PORT" proto tcp comment "RDP via Tailscale (CIDR)" >>"$LOG_FILE" 2>&1 || true
  run "Mengaktifkan UFW" fw_enable
  ok "Port ${RDP_PORT} hanya dibenarkan dari ${TAILSCALE_CIDR} / tailscale0"

  if [[ -n "$payload" ]]; then
    step "7/8  Skrip bootstrap"
    rdp_deploy_payload "$payload" "$rdp_user"
  else
    note "7/8  Skrip bootstrap dilangkau"
  fi

  step "8/8  Pemeriksaan akhir"
  if [[ -n "$ts_ip" ]]; then
    if try "Pemeriksaan TCP ${ts_ip}:${RDP_PORT}" tcp_probe_file "$ts_ip" "$RDP_PORT" 60; then alive=1; fi
  else
    warn "Alamat Tailscale belum ada; pemeriksaan TCP dilangkau."
    ts_ip="<alamat Tailscale>"
  fi

  cred="$STATE_DIR/credentials/rdp.txt"
  ( umask 077
    cat >"$cred" <<EOF
RDP  -  $(date '+%F %T')
Alamat     : ${ts_ip}
Port       : ${RDP_PORT}
Pengguna   : ${rdp_user}
Kata laluan: ${final_pass}
Hos        : ${ts_host}
Firewall   : ${RDP_PORT} hanya dari ${TAILSCALE_CIDR}
EOF
  )
  fix_owner "$cred"

  local status_line
  if (( alive )); then status_line="${C_GRN}lulus${C_RST}"; else status_line="${C_YEL}menunggu sambungan Tailscale${C_RST}"; fi
  printf '\n'
  ui_box "RDP SEDIA" "$C_GRN" \
    "$(kv "Alamat" "$ts_ip")" \
    "$(kv "Port" "$RDP_PORT")" \
    "$(kv "Pengguna" "$rdp_user")" \
    "$(kv "Kata laluan" "$final_pass")" \
    "$(kv "Hos" "$ts_host")" \
    "$(kv "Health-check" "$status_line")" \
    "---" \
    "Windows : mstsc /v:${ts_ip}" \
    "macOS   : Microsoft Remote Desktop, tambah PC ${ts_ip}" \
    "Linux   : xfreerdp /u:${rdp_user} /v:${ts_ip}:${RDP_PORT}" \
    "Klien mesti disambungkan ke tailnet yang sama."
  if (( strengthened )); then note "Kata laluan asal diperkuatkan secara automatik."; fi
  note "Kelayakan disimpan (chmod 600): $cred"
}

# ------------------------------------------------------------------------------
#  Docker Engine
# ------------------------------------------------------------------------------
module_docker() {
  hdr "MODUL $(mod_no docker)" "Docker Engine"
  docker_ensure
  if [[ "$REAL_USER" != "root" ]]; then
    sudo usermod -aG docker "$REAL_USER"
    ok "Pengguna '$REAL_USER' ditambah ke kumpulan docker (log keluar dan masuk semula)"
  fi
  ok "Docker : $(docker --version | cut -d, -f1)"
  if docker compose version >/dev/null 2>&1; then
    ok "Compose: $(docker compose version --short 2>/dev/null || docker compose version)"
  else
    warn "Plugin Docker Compose tidak dijumpai."
  fi
}

# ------------------------------------------------------------------------------
#  Node.js LTS
# ------------------------------------------------------------------------------
module_nodejs() {
  hdr "MODUL $(mod_no nodejs)" "Node.js LTS"
  if command_exists node; then
    ok "Node sudah dipasang ($(node --version))"
  else
    run "Memuat turun skrip repositori NodeSource" curl -fsSL https://deb.nodesource.com/setup_lts.x -o "$RUN_DIR/nodesource.sh"
    run "Menambah repositori NodeSource" sudo -E bash "$RUN_DIR/nodesource.sh"
    apt_install nodejs
  fi
  run "Memasang pm2 dan yarn (global)" sudo npm install -g pm2 yarn
  ok "Node: $(node --version) | npm: $(npm --version) | yarn: $(yarn --version 2>/dev/null || echo -) | pm2: $(pm2 --version 2>/dev/null | tail -n1 || echo -)"
}

# ------------------------------------------------------------------------------
#  Tailscale (berdiri sendiri)
# ------------------------------------------------------------------------------
module_tailscale() {
  local key host ts_ip=""
  hdr "MODUL $(mod_no tailscale)" "Tailscale VPN"
  tailscale_install

  key="$(ask_secret "Auth key (kosong = sambung manual dengan 'sudo tailscale up')")"
  if [[ -z "$key" ]]; then
    note "Sambung manual: sudo tailscale up"
    return 0
  fi
  if [[ "$key" != tskey-* ]]; then warn "Auth key tidak bermula dengan 'tskey-'. Semak semula."; fi
  host="$(sanitize_hostname "$(ask "Nama hos node" "$(hostname -s)")")"

  if ! tailscale_connect "$key" "$host"; then
    die "Gagal menyambung ke tailnet. Semak auth key (satu kali guna atau tamat tempoh?) dan log: $LOG_FILE"
  fi
  rm -f "$RUN_DIR/tsip"
  try "Menunggu alamat IP Tailscale" wait_ts_ip "$RUN_DIR/tsip" 180 || true
  if [[ -s "$RUN_DIR/tsip" ]]; then ts_ip="$(<"$RUN_DIR/tsip")"; ok "Tersambung. IP Tailscale: $ts_ip"; fi
  if [[ -z "$ts_ip" ]]; then warn "IP belum diperoleh. Semak: sudo tailscale status"; fi
}

#==============================================================================
#  MODUL: Firewall, Dev Tools, Monitoring
#==============================================================================

# ------------------------------------------------------------------------------
#  Firewall (UFW)
# ------------------------------------------------------------------------------
module_firewall() {
  local extra tok api sftp found=0
  local -a toks=()
  hdr "MODUL $(mod_no firewall)" "Firewall (UFW)"

  step "Dasar asas"
  fw_ensure_base
  ok "SSH dibenarkan pada port: $(fw_ssh_ports | tr '\n' ' ')"
  ok "Dasar lalai: tolak trafik masuk, benarkan trafik keluar"

  step "Pengesanan perkhidmatan"
  if [[ -x /usr/local/bin/wings ]] && declare -F wings_ports >/dev/null; then
    read -r api sftp < <(wings_ports)
    fw_allow "${api}/tcp" "Pterodactyl Wings API"
    fw_allow "${sftp}/tcp" "Pterodactyl Wings SFTP"
    ok "Wings: API ${api}/tcp, SFTP ${sftp}/tcp"
    found=1
  fi
  if systemctl is-active --quiet libvirtd 2>/dev/null || systemctl is-active --quiet libvirtd.socket 2>/dev/null; then
    if declare -F fw_libvirt_rules >/dev/null; then fw_libvirt_rules; fi
    ok "libvirt: peraturan bridge virbr0 (DHCP, DNS, NAT)"
    found=1
  fi
  if systemctl is-active --quiet pyserver 2>/dev/null; then
    fw_allow "${SERVER_PORT}/tcp" "Python server"
    ok "Python server: ${SERVER_PORT}/tcp"
    found=1
  fi
  if (( found == 0 )); then note "Tiada perkhidmatan dikenali yang memerlukan peraturan automatik."; fi

  if command_exists tailscale; then
    if ask_yn "Percayai semua trafik masuk melalui Tailscale (antara muka tailscale0)?" n; then
      sudo ufw allow in on tailscale0 comment "Tailscale dipercayai" >>"$LOG_FILE" 2>&1 || true
      ok "tailscale0 dipercayai"
    fi
  fi

  extra="$(ask "Port tambahan untuk dibuka (cth 80,443,25565:25665/tcp; kosong = langkau)" "")"
  if [[ -n "$extra" ]]; then
    IFS=',' read -ra toks <<<"${extra// /}"
    for tok in "${toks[@]}"; do
      if ! [[ "$tok" =~ ^[0-9]{1,5}(:[0-9]{1,5})?(/(tcp|udp))?$ ]]; then
        warn "Dilangkau (format tidak sah): $tok"
        continue
      fi
      if [[ "$tok" == *:* && "$tok" != */* ]]; then
        fw_allow "${tok}/tcp" "Port tambahan"
        fw_allow "${tok}/udp" "Port tambahan"
      else
        fw_allow "$tok" "Port tambahan"
      fi
      ok "Dibenarkan: $tok"
    done
  fi

  step "Aktifkan"
  run "Mengaktifkan UFW" fw_enable
  printf '\n'
  sudo ufw status numbered | sed 's/^/  /'
  if command_exists docker; then
    printf '\n'
    note "Nota: port yang diterbitkan oleh Docker (-p) memintas UFW. Hadkan melalui rantai DOCKER-USER"
    note "atau ikat port kepada 127.0.0.1 jika perkhidmatan tidak patut didedahkan."
  fi
}

# ------------------------------------------------------------------------------
#  Dev Tools
# ------------------------------------------------------------------------------
module_devtools() {
  local mark="# >>> setup_server.sh >>>" rc="$REAL_HOME/.bashrc"
  hdr "MODUL $(mod_no devtools)" "Dev Tools"

  step "Pakej"
  apt_install git curl wget tmux htop jq tree ncdu net-tools lsof unzip zip \
              build-essential pkg-config cmake zsh neovim vim nano
  apt_install_optional ripgrep fzf bat fd-find silversearcher-ag btop mtr-tiny \
                       iotop dstat strace p7zip-full dnsutils traceroute

  if command_exists batcat && ! command_exists bat; then sudo ln -sf "$(command -v batcat)" /usr/local/bin/bat; fi
  if command_exists fdfind && ! command_exists fd;  then sudo ln -sf "$(command -v fdfind)" /usr/local/bin/fd; fi

  step "Oh My Zsh"
  if [[ -d "$REAL_HOME/.oh-my-zsh" ]]; then
    ok "Oh My Zsh sudah dipasang"
  else
    run "Memuat turun pemasang Oh My Zsh" curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh -o "$RUN_DIR/omz.sh"
    run "Memasang Oh My Zsh" as_user env HOME="$REAL_HOME" RUNZSH=no CHSH=no sh "$RUN_DIR/omz.sh" --unattended
    note "Tukar shell lalai: chsh -s $(command -v zsh)"
  fi

  step "Alias dan prompt"
  if grep -qF "$mark" "$rc" 2>/dev/null; then
    ok "Alias sudah ditambah ke $rc"
  else
    as_user tee -a "$rc" >/dev/null <<'ALIASES'

# >>> setup_server.sh >>>
alias ll='ls -alFh --color=auto'
alias la='ls -A --color=auto'
alias grep='grep --color=auto'
alias ports='ss -tulnp'
alias myip='curl -s ifconfig.me && echo'
alias update='sudo apt update && sudo apt upgrade -y'
alias gs='git status'
alias gl='git log --oneline -10'
alias dps='docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'
export EDITOR=nvim
PS1='\[\033[1;36m\]\u\[\033[0m\]@\[\033[1;34m\]\h\[\033[0m\] \[\033[1;33m\]\w\[\033[0m\] \[\033[1;32m\]\$\[\033[0m\] '
# <<< setup_server.sh <<<
ALIASES
    ok "Alias dan prompt ditambah ke $rc  (jalankan: source ~/.bashrc)"
  fi
}

# ------------------------------------------------------------------------------
#  Monitoring (Netdata)
# ------------------------------------------------------------------------------
module_monitoring() {
  local bind tsip
  hdr "MODUL $(mod_no monitoring)" "Monitoring (Netdata)"

  if command_exists netdata; then
    ok "Netdata sudah dipasang"
  else
    run "Memuat turun skrip kickstart Netdata" curl -fsSL https://get.netdata.cloud/kickstart.sh -o "$RUN_DIR/netdata-kickstart.sh"
    run "Memasang Netdata (saluran stable)" sudo sh "$RUN_DIR/netdata-kickstart.sh" --non-interactive --stable-channel
  fi

  ask_choice "Akses dashboard Netdata" 1 \
    "Localhost sahaja (selamat; gunakan terowong SSH)" \
    "Localhost dan Tailscale (jika tersedia)" \
    "Semua antara muka (buka port 19999)" || CHOICE=1

  case "$CHOICE" in
    2) tsip="$(tailscale_ip_now)"
       if [[ -n "$tsip" ]]; then bind="127.0.0.1 $tsip"
       else warn "Tailscale tiada IP; menggunakan localhost sahaja."; bind="127.0.0.1"; fi ;;
    3) bind="*" ;;
    *) bind="127.0.0.1" ;;
  esac

  ini_set /etc/netdata/netdata.conf web "bind to" "$bind"
  run "Memulakan semula Netdata" sudo systemctl restart netdata
  if [[ "$bind" == "*" ]]; then fw_allow "19999/tcp" "Netdata"; fi

  printf '\n'
  case "$bind" in
    "*")  ok "Dashboard: http://$(host_ip):19999" ;;
    127.0.0.1) ok "Dashboard: http://127.0.0.1:19999"
               note "Dari PC anda: ssh -L 19999:127.0.0.1:19999 ${REAL_USER}@$(host_ip)  kemudian buka http://localhost:19999" ;;
    *)    ok "Dashboard: http://${bind##* }:19999 (melalui Tailscale)" ;;
  esac
}

#==============================================================================
#  MODUL: Cloudflare Tunnel, Mesh VPN (ZeroTier, NetBird)
#==============================================================================

# ------------------------------------------------------------------------------
#  Cloudflare Tunnel (cloudflared, tunnel diurus dari dashboard menggunakan token)
# ------------------------------------------------------------------------------
CF_TOKEN=""

cloudflared_extract_token() {  # ambil token daripada teks yang ditampal (token sahaja atau arahan penuh)
  printf '%s' "$1" | grep -oE 'eyJ[A-Za-z0-9+/=_-]{40,}' | head -n1 || true
}

cloudflared_install_pkg() {  # repositori apt rasmi Cloudflare; sandaran: pakej .deb dari GitHub
  local key arch deb
  sudo mkdir -p --mode=0755 /usr/share/keyrings
  for key in cloudflare-public-v2 cloudflare-main; do
    if curl -fsSL "https://pkg.cloudflare.com/${key}.gpg" | sudo tee "/usr/share/keyrings/${key}.gpg" >/dev/null; then
      printf 'deb [signed-by=/usr/share/keyrings/%s.gpg] https://pkg.cloudflare.com/cloudflared any main\n' "$key" \
        | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
      if sudo apt-get update -qq && sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cloudflared; then
        return 0
      fi
    fi
  done
  # Repositori gagal: buang supaya 'apt update' modul lain tidak rosak, kemudian guna .deb terus.
  sudo rm -f /etc/apt/sources.list.d/cloudflared.list
  sudo apt-get update -qq || true
  case "$(uname -m)" in
    x86_64)        arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) return 1 ;;
  esac
  deb="$RUN_DIR/cloudflared.deb"
  curl -fL --retry 3 -o "$deb" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb"
  sudo dpkg -i "$deb"
}

cloudflared_install() {
  if command_exists cloudflared; then
    ok "cloudflared sudah dipasang ($(cloudflared --version 2>/dev/null | head -n1))"
    return 0
  fi
  run "Memasang cloudflared" cloudflared_install_pkg
  ok "cloudflared: $(cloudflared --version 2>/dev/null | head -n1)"
}

cloudflared_ask_token() {  # minta token secara terus -> CF_TOKEN (status 1 jika dilangkau / tidak sah)
  local raw attempt
  CF_TOKEN=""
  note "Token: Cloudflare Zero Trust > Networks > Tunnels > Create a tunnel > Cloudflared."
  note "Boleh tampal token sahaja, atau seluruh arahan 'cloudflared service install ...'."
  for attempt in 1 2 3; do
    raw="$(ask_secret "Tunnel token Cloudflare (kosong = langkau)")"
    if [[ -z "$raw" ]]; then return 1; fi
    CF_TOKEN="$(cloudflared_extract_token "$raw")"
    if [[ -z "$CF_TOKEN" ]]; then CF_TOKEN="$(printf '%s' "$raw" | awk '{print $NF}')"; fi
    if [[ "$CF_TOKEN" =~ ^[A-Za-z0-9+/=_-]{60,}$ ]]; then
      ok "Token diterima (${#CF_TOKEN} aksara)"
      return 0
    fi
    warn "Format token tidak dikenali (percubaan ${attempt}/3)."
    CF_TOKEN=""
  done
  return 1
}

cloudflared_wait_connected() {  # tunggu sehingga tunnel berdaftar dengan edge Cloudflare
  local timeout="${1:-45}" deadline out
  deadline=$(( $(date +%s) + timeout ))
  while (( $(date +%s) < deadline )); do
    out="$(sudo journalctl -u cloudflared --no-pager -n 80 2>/dev/null || true)"
    if grep -q 'Registered tunnel connection' <<<"$out"; then return 0; fi
    sleep 2
  done
  return 1
}

# Pasang perkhidmatan systemd menggunakan CF_TOKEN (diminta sekarang jika masih kosong).
# Status: 0 = berjaya, 1 = gagal, 2 = dilangkau (tiada token).
cloudflared_connect() {
  if systemctl is-active --quiet cloudflared 2>/dev/null; then
    ok "Perkhidmatan cloudflared sudah aktif."
    if ! ask_yn "Ganti dengan tunnel (token) baharu?" n; then return 0; fi
    run "Membuang perkhidmatan cloudflared lama" sudo cloudflared service uninstall
  fi
  if [[ -z "$CF_TOKEN" ]]; then
    if ! cloudflared_ask_token; then warn "Token tidak diberikan; tunnel dilangkau."; return 2; fi
  fi
  if ! RUN_REDACT=1 try "Memasang perkhidmatan tunnel (cloudflared service install)" \
         sudo cloudflared service install "$CF_TOKEN"; then
    warn "Pemasangan perkhidmatan gagal. Log: $LOG_FILE"
    return 1
  fi
  # Token tersimpan dalam unit systemd; hadkan bacaan kepada root.
  sudo chmod 600 /etc/systemd/system/cloudflared.service 2>/dev/null || true
  sudo systemctl daemon-reload
  sudo systemctl enable --now cloudflared >>"$LOG_FILE" 2>&1 || true
  if try "Menunggu tunnel berdaftar dengan Cloudflare" cloudflared_wait_connected 45; then
    ok "Tunnel aktif dan bersambung ke Cloudflare"
  else
    warn "Tunnel belum berdaftar. Semak token dan log: journalctl -u cloudflared -n 50"
  fi
  return 0
}

cloudflared_hostname_help() {  # arahan konfigurasi Public Hostname di dashboard
  printf '\n'
  ui_box "LANGKAH SETERUSNYA DI CLOUDFLARE" "$C_CYN" \
    "Zero Trust > Networks > Tunnels > (tunnel anda) > Public Hostname > Add" \
    "---" \
    "Panel Pterodactyl : panel.domain-anda.com   Service: HTTP   127.0.0.1:80" \
    "Wings (pilihan)   : wings.domain-anda.com   Service: HTTP   127.0.0.1:8080" \
    "Aplikasi Python   : app.domain-anda.com     Service: HTTP   127.0.0.1:${SERVER_PORT}" \
    "---" \
    "Gunakan 127.0.0.1 (bukan 'localhost') supaya sambungan tidak cuba IPv6." \
    "Tunnel hanya membawa HTTP/HTTPS. SFTP dan port permainan tidak melalui tunnel."
}

module_cloudflared() {
  hdr "MODUL $(mod_no cloudflared)" "Cloudflare Tunnel"
  note "Tunnel keluar sahaja: tiada port masuk dibuka dan IP pelayan tersembunyi."

  step "1/3  cloudflared"
  cloudflared_install

  step "2/3  Token tunnel"
  CF_TOKEN=""
  local rc=0
  cloudflared_connect || rc=$?
  CF_TOKEN=""
  case "$rc" in
    0) step "3/3  Konfigurasi laluan"; cloudflared_hostname_help ;;
    2) skip_module "Tiada token tunnel diberikan." ;;
    *) die "Tunnel gagal dipasang. Semak token dan log: $LOG_FILE" ;;
  esac
}

# ------------------------------------------------------------------------------
#  Mesh VPN: ZeroTier dan NetBird  (Tailscale: modul berasingan)
# ------------------------------------------------------------------------------
mesh_zerotier() {
  local nid info
  step "ZeroTier"
  if command_exists zerotier-cli; then
    ok "ZeroTier sudah dipasang"
  else
    run "Memuat turun pemasang ZeroTier" curl -fsSL https://install.zerotier.com -o "$RUN_DIR/zerotier-install.sh"
    run "Memasang ZeroTier" sudo bash "$RUN_DIR/zerotier-install.sh"
  fi
  run "Mengaktifkan zerotier-one" sudo systemctl enable --now zerotier-one

  nid="$(ask "ZeroTier Network ID (16 aksara hex; kosong = langkau)" "")"
  if [[ -z "$nid" ]]; then note "Sertai kemudian: sudo zerotier-cli join <network-id>"; return 0; fi
  if ! [[ "$nid" =~ ^[0-9a-fA-F]{16}$ ]]; then warn "Network ID tidak sah: $nid"; return 0; fi
  if try "Menyertai rangkaian ${nid}" sudo zerotier-cli join "$nid"; then
    info="$(sudo zerotier-cli info 2>/dev/null || true)"
    ok "ZeroTier: ${info:-dihantar}"
    note "Luluskan node ini di https://my.zerotier.com (Members > Auth) supaya mendapat alamat IP."
  fi
}

mesh_netbird() {
  local key url
  local -a args=()
  step "NetBird"
  if command_exists netbird; then
    ok "NetBird sudah dipasang ($(netbird version 2>/dev/null | head -n1))"
  else
    run "Memuat turun pemasang NetBird" curl -fsSL https://pkgs.netbird.io/install.sh -o "$RUN_DIR/netbird-install.sh"
    run "Memasang NetBird" sudo sh "$RUN_DIR/netbird-install.sh"
  fi

  key="$(ask_secret "NetBird setup key (kosong = log masuk SSO secara manual)")"
  if [[ -z "$key" ]]; then note "Sambung kemudian: sudo netbird up"; return 0; fi
  url="$(ask "Management URL (kosong = NetBird Cloud)" "")"
  args=(netbird up --setup-key "$key")
  if [[ -n "$url" ]]; then args+=(--management-url "$url"); fi
  if RUN_REDACT=1 try "Menyambung ke NetBird" sudo "${args[@]}"; then
    sudo netbird status 2>/dev/null | sed 's/^/        /' || true
  else
    warn "Sambungan gagal. Semak setup key dan Management URL."
  fi
}

module_mesh() {
  hdr "MODUL $(mod_no mesh)" "Mesh VPN lain (ZeroTier, NetBird)"
  note "Tailscale tersedia sebagai modul $(mod_no tailscale) dan digunakan oleh RDP, KVM dan Netdata."
  ask_choice "Pilih rangkaian mesh" 1 \
    "ZeroTier  (join dengan Network ID)" \
    "NetBird   (setup key atau SSO)" \
    "Kedua-duanya" || skip_module "Dibatalkan oleh pengguna."
  case "$CHOICE" in
    1) mesh_zerotier ;;
    2) mesh_netbird ;;
    3) mesh_zerotier; mesh_netbird ;;
  esac
}

#==============================================================================
#  MODUL: Mesin Maya (KVM / libvirt)
#  - Linux : imej cloud rasmi + cloud-init (siap dalam ~1 minit)
#  - Windows / OS lain : ISO + konsol VNC
#==============================================================================

VM_IMG_DIR="/var/lib/libvirt/images"
VM_BASE_DIR="/var/lib/libvirt/images/base"
VM_ISO_DIR="/var/lib/libvirt/boot"
VIRTIO_URL="https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"
VM_KVM_OK=1
VM_AUTOSTART=0

# id|label|keluarga|osinfo-variant (keutamaan)|pengguna lalai|url imej|url checksum|jenis checksum
VM_CATALOG=(
  "ubuntu2604|Ubuntu 26.04 LTS (Resolute Raccoon)|debian|ubuntu26.04 ubuntu25.10 ubuntu24.04|ubuntu|https://cloud-images.ubuntu.com/releases/resolute/release/ubuntu-26.04-server-cloudimg-amd64.img|https://cloud-images.ubuntu.com/releases/resolute/release/SHA256SUMS|sha256"
  "ubuntu2404|Ubuntu 24.04 LTS (Noble Numbat)|debian|ubuntu24.04 ubuntu22.04|ubuntu|https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img|https://cloud-images.ubuntu.com/releases/24.04/release/SHA256SUMS|sha256"
  "ubuntu2204|Ubuntu 22.04 LTS (Jammy Jellyfish)|debian|ubuntu22.04 ubuntu20.04|ubuntu|https://cloud-images.ubuntu.com/releases/22.04/release/ubuntu-22.04-server-cloudimg-amd64.img|https://cloud-images.ubuntu.com/releases/22.04/release/SHA256SUMS|sha256"
  "debian13|Debian 13 (Trixie)|debian|debian13 debian12|debian|https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2|https://cloud.debian.org/images/cloud/trixie/latest/SHA512SUMS|sha512"
  "debian12|Debian 12 (Bookworm)|debian|debian12 debian11|debian|https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2|https://cloud.debian.org/images/cloud/bookworm/latest/SHA512SUMS|sha512"
  "rocky9|Rocky Linux 9|rhel|rocky9 centos-stream9 rhel9.0|rocky|https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud.latest.x86_64.qcow2||"
  "alma9|AlmaLinux 9|rhel|almalinux9 centos-stream9 rhel9.0|almalinux|https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2||"
)

virsh_() { sudo virsh -c qemu:///system "$@"; }

# --- Sambungan firewall untuk bridge libvirt --------------------------------------------------
fw_libvirt_rules() {
  command_exists ufw || return 0
  sudo ufw allow in on virbr0 comment "libvirt DHCP/DNS" >>"$LOG_FILE" 2>&1 || true
  sudo ufw route allow in on virbr0 comment "libvirt NAT keluar" >>"$LOG_FILE" 2>&1 || true
  sudo ufw route allow out on virbr0 comment "libvirt NAT masuk" >>"$LOG_FILE" 2>&1 || true
}

# --- Persediaan hos KVM -----------------------------------------------------------------------
kvm_start_daemons() {
  if sudo systemctl enable --now libvirtd.service >/dev/null 2>&1 \
     || sudo systemctl enable --now libvirtd.socket >/dev/null 2>&1; then
    return 0
  fi
  local s  # libvirt versi baharu menggunakan daemon modular
  for s in virtqemud virtnetworkd virtstoraged virtnodedevd virtnwfilterd virtlogd virtlockd; do
    sudo systemctl enable --now "${s}.socket" >/dev/null 2>&1 || true
  done
}

kvm_ensure_network() {
  if ! virsh_ net-info default >/dev/null 2>&1; then
    if [[ -f /usr/share/libvirt/networks/default.xml ]]; then
      virsh_ net-define /usr/share/libvirt/networks/default.xml >/dev/null
    fi
  fi
  if ! virsh_ net-info default 2>/dev/null | grep -Eq 'Active:[[:space:]]+yes'; then
    virsh_ net-start default >/dev/null
  fi
  virsh_ net-autostart default >/dev/null 2>&1 || true
}

kvm_host_setup() {
  local arch virt mark="# >>> libvirt uri >>>"
  arch="$(uname -m)"
  if [[ "$arch" != "x86_64" ]]; then die "Modul ini hanya menyokong x86_64 (sistem anda: $arch)."; fi
  virt="$(systemd-detect-virt 2>/dev/null || true)"
  case "$virt" in
    openvz|lxc|lxc-libvirt|docker|podman|systemd-nspawn|wsl)
      die "Persekitaran '$virt' tidak menyokong KVM. Gunakan pelayan KVM atau dedicated." ;;
  esac

  step "Semakan perkakasan"
  if grep -Eqw 'vmx|svm' /proc/cpuinfo; then
    ok "CPU menyokong virtualisasi perkakasan (VT-x / AMD-V)"
  else
    warn "Bendera vmx/svm tiada pada CPU ini."
  fi
  if [[ -n "$virt" && "$virt" != "none" ]]; then
    info "Hos ialah mesin maya ($virt). Nested virtualization mesti diaktifkan oleh penyedia."
  fi

  step "Pakej KVM dan libvirt"
  apt_install qemu-system-x86 qemu-utils libvirt-daemon-system libvirt-clients virtinst \
              ovmf swtpm swtpm-tools libosinfo-bin cloud-image-utils dnsmasq-base openssl
  if [[ -d /var/lib/swtpm-localca ]] && id tss >/dev/null 2>&1; then
    sudo chown -R tss:tss /var/lib/swtpm-localca 2>/dev/null || true
  fi

  if [[ ! -c /dev/kvm ]]; then
    try "Memuatkan modul kernel KVM" bash -c 'sudo modprobe kvm_intel 2>/dev/null || sudo modprobe kvm_amd 2>/dev/null || sudo modprobe kvm' || true
  fi
  if [[ -c /dev/kvm ]]; then
    VM_KVM_OK=1; ok "/dev/kvm tersedia (pecutan perkakasan aktif)"
  else
    VM_KVM_OK=0
    warn "/dev/kvm tiada. VM akan berjalan dengan emulasi perisian (sangat perlahan; Windows tidak praktikal)."
  fi

  step "Perkhidmatan libvirt"
  run "Mengaktifkan daemon libvirt" kvm_start_daemons
  run "Menyemak sambungan libvirt" virsh_ list --all
  run "Memastikan rangkaian 'default' (NAT) aktif" kvm_ensure_network
  sudo mkdir -p "$VM_BASE_DIR" "$VM_ISO_DIR"
  fw_libvirt_rules
  if [[ "$REAL_USER" != "root" ]]; then
    sudo usermod -aG libvirt,kvm "$REAL_USER" 2>/dev/null || true
  fi
  if ! grep -qF "$mark" "$REAL_HOME/.bashrc" 2>/dev/null; then
    printf '\n%s\nexport LIBVIRT_DEFAULT_URI=qemu:///system\n# <<< libvirt uri <<<\n' "$mark" \
      | as_user tee -a "$REAL_HOME/.bashrc" >/dev/null
  fi
  ok "Hos KVM sedia. Direktori cakera: $VM_IMG_DIR"
}

# --- Utiliti VM ---------------------------------------------------------------------------------
OSINFO_IDS=""
osinfo_has() {
  if [[ -z "$OSINFO_IDS" ]]; then
    OSINFO_IDS="$(osinfo-query os -f short-id 2>/dev/null | awk 'NR > 2 {print $1}')"
  fi
  grep -qx "$1" <<<"$OSINFO_IDS"
}

pick_variant() {  # pick_variant "id1 id2 id3"  -> ID pertama yang dikenali, jika tiada: generic
  local v
  for v in $1; do
    if osinfo_has "$v"; then printf '%s' "$v"; return 0; fi
  done
  printf 'generic'
}

vm_catalog_get() {  # vm_catalog_get <id>  -> VM_ID VM_LABEL VM_FAMILY VM_VARIANTS VM_USER VM_URL VM_SUMURL VM_SUMKIND
  local e
  for e in "${VM_CATALOG[@]}"; do
    IFS='|' read -r VM_ID VM_LABEL VM_FAMILY VM_VARIANTS VM_USER VM_URL VM_SUMURL VM_SUMKIND <<<"$e"
    if [[ "$VM_ID" == "$1" ]]; then return 0; fi
  done
  return 1
}

VM_PICK=""
vm_pick_image() {  # vm_pick_image <regex-id>  -> VM_PICK
  local re="$1" e id label
  local -a ids=() labels=()
  for e in "${VM_CATALOG[@]}"; do
    IFS='|' read -r id label _ <<<"$e"
    if [[ "$id" =~ $re ]]; then ids+=("$id"); labels+=("$label"); fi
  done
  ask_choice "Pilih versi" 1 "${labels[@]}" || return 1
  VM_PICK="${ids[CHOICE-1]}"
}

vm_download() {  # vm_download <url> <tujuan>   (bar kemajuan dipaparkan oleh curl)
  local url="$1" dest="$2" part
  part="${dest}.part"
  info "Memuat turun: ${dest##*/}"
  if ! sudo curl -fL --retry 3 --retry-delay 2 -# -o "$part" "$url"; then
    sudo rm -f "$part"
    die "Muat turun gagal: $url"
  fi
  sudo mv -f "$part" "$dest"
  ok "Muat turun selesai: ${dest##*/} ($(sudo du -h "$dest" | cut -f1))"
}

vm_verify_checksum() {  # vm_verify_checksum <fail> <url-sums> <jenis>
  local f="$1" url="$2" kind="$3" name expected actual
  if [[ -z "$url" || -z "$kind" ]]; then note "Checksum tidak disahkan untuk imej ini (tiada sumber rasmi mudah)."; return 0; fi
  name="${f##*/}"
  expected="$(curl -fsSL --max-time 30 "$url" 2>/dev/null | awk -v n="$name" '{ f = $2; sub(/^\*/, "", f); if (f == n) { print $1; exit } }' || true)"
  if [[ -z "$expected" ]]; then warn "Entri checksum untuk $name tidak dijumpai; pengesahan dilangkau."; return 0; fi
  actual="$(sudo "${kind}sum" "$f" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    sudo rm -f "$f"
    die "Checksum ${kind^^} tidak sepadan. Imej rosak dan telah dipadam; cuba semula."
  fi
  ok "Checksum ${kind^^} disahkan"
}

vm_fetch_image() {  # -> VM_BASE_IMG (guna cache; muat turun jika tiada / terlalu lama)
  local file age_days
  file="${VM_URL##*/}"
  VM_BASE_IMG="$VM_BASE_DIR/$file"
  if sudo test -s "$VM_BASE_IMG"; then
    age_days=$(( ( $(date +%s) - $(sudo stat -c %Y "$VM_BASE_IMG") ) / 86400 ))
    ok "Imej asas dijumpai dalam cache: $file (umur ${age_days} hari)"
    if (( age_days > 30 )) && ask_yn "Imej berusia lebih 30 hari. Muat turun versi terkini?" y; then
      sudo rm -f "$VM_BASE_IMG"
    fi
  fi
  if ! sudo test -s "$VM_BASE_IMG"; then
    vm_download "$VM_URL" "$VM_BASE_IMG"
    vm_verify_checksum "$VM_BASE_IMG" "$VM_SUMURL" "$VM_SUMKIND"
  fi
}

vm_ask_name() {  # vm_ask_name <lalai>  -> VM_NAME
  local n
  n="$(ask "Nama VM" "$1")"
  if ! [[ "$n" =~ ^[A-Za-z][A-Za-z0-9._-]{0,30}$ ]]; then
    die "Nama VM tidak sah (mula dengan huruf; huruf, nombor, . _ - sahaja; maks 31 aksara)."
  fi
  if virsh_ dominfo "$n" >/dev/null 2>&1; then die "VM bernama '$n' sudah wujud."; fi
  VM_NAME="$n"
}

vm_ask_resources() {  # vm_ask_resources <cpu> <ram MiB> <disk GiB>  -> VM_CPU VM_RAM VM_DISK
  local host_cpu host_ram cap def_cpu="$1" def_ram="$2" def_disk="$3" avail
  host_cpu="$(nproc)"
  host_ram="$(awk '/MemTotal/ {printf "%d", $2 / 1024}' /proc/meminfo)"
  cap=$(( host_ram * 6 / 10 / 256 * 256 ))
  if (( def_ram > cap && cap >= 512 )); then def_ram=$cap; fi
  if (( def_cpu > host_cpu )); then def_cpu=$host_cpu; fi

  VM_CPU="$(ask "Bilangan vCPU (hos: ${host_cpu})" "$def_cpu")"
  VM_RAM="$(ask "RAM dalam MiB (hos: ${host_ram})" "$def_ram")"
  VM_DISK="$(ask "Saiz cakera dalam GiB" "$def_disk")"
  [[ "$VM_CPU" =~ ^[1-9][0-9]*$ ]]  || die "Nilai vCPU tidak sah."
  [[ "$VM_RAM" =~ ^[1-9][0-9]*$ ]]  || die "Nilai RAM tidak sah."
  [[ "$VM_DISK" =~ ^[1-9][0-9]*$ ]] || die "Nilai cakera tidak sah."
  if (( VM_RAM < 512 )); then die "RAM minimum ialah 512 MiB."; fi
  if (( VM_DISK < 8 )); then die "Cakera minimum ialah 8 GiB."; fi
  if (( VM_RAM > host_ram * 9 / 10 )); then warn "RAM VM melebihi 90% RAM hos."; fi
  avail="$(df -BG --output=avail "$VM_IMG_DIR" 2>/dev/null | tail -n1 | tr -dc '0-9')"
  if [[ -n "$avail" ]] && (( VM_DISK > avail )); then
    warn "Cakera VM (${VM_DISK} GiB) melebihi ruang bebas (${avail} GiB). Cakera bersifat thin, tetapi berisiko penuh."
  fi
}

vm_wait_ip_file() {  # vm_wait_ip_file <nama> <fail> <had-saat>
  local name="$1" out="$2" timeout="${3:-180}" deadline addr
  deadline=$(( $(date +%s) + timeout ))
  while (( $(date +%s) < deadline )); do
    addr="$(virsh_ domifaddr "$name" --source lease 2>/dev/null | awk '/ipv4/ {split($4, a, "/"); print a[1]; exit}')"
    if [[ -n "$addr" ]]; then printf '%s' "$addr" >"$out"; return 0; fi
    sleep 3
  done
  return 1
}

vm_ip_of() {
  virsh_ domifaddr "$1" --source lease 2>/dev/null | awk '/ipv4/ {split($4, a, "/"); print a[1]; exit}'
}

vm_reserve_ip() {  # kunci IP semasa melalui DHCP reservation supaya tidak berubah
  local name="$1" addr="$2" mac
  mac="$(virsh_ domiflist "$name" 2>/dev/null | awk '$2 == "network" {print $5; exit}')"
  if [[ -z "$mac" ]]; then return 1; fi
  if virsh_ net-dumpxml default 2>/dev/null | grep -q "mac='$mac'"; then return 0; fi
  virsh_ net-update default add ip-dhcp-host "<host mac='$mac' name='$name' ip='$addr'/>" --live --config >/dev/null 2>&1
}

vm_hash_password() { printf '%s' "$1" | openssl passwd -6 -stdin; }

vm_collect_keys() {  # kunci awam SSH pengguna (id_*.pub dan authorized_keys), maks 5 baris
  local f
  {
    for f in "$REAL_HOME"/.ssh/id_*.pub; do
      if [[ -r "$f" ]]; then cat "$f"; fi
    done
    if [[ -r "$REAL_HOME/.ssh/authorized_keys" ]]; then grep -E '^(ssh-|ecdsa-|sk-)' "$REAL_HOME/.ssh/authorized_keys" || true; fi
  } 2>/dev/null | awk 'NF >= 2 && !seen[$2]++' | head -n 5
}

vm_write_cloudinit() {  # <direktori> <nama> <pengguna> <kata-laluan> <keluarga> <kunci (berbilang baris)>
  local dir="$1" name="$2" user="$3" pass="$4" family="$5" keys="$6" hash grp k
  hash="$(vm_hash_password "$pass")"
  if [[ "$family" == "rhel" ]]; then grp="wheel"; else grp="sudo"; fi
  {
    printf '#cloud-config\n'
    printf 'hostname: %s\n' "$name"
    printf 'manage_etc_hosts: true\n'
    printf 'users:\n'
    printf '  - name: %s\n' "$user"
    printf '    groups: [%s]\n' "$grp"
    printf '    shell: /bin/bash\n'
    printf '    sudo: "ALL=(ALL) NOPASSWD:ALL"\n'
    printf '    lock_passwd: false\n'
    printf '    passwd: "%s"\n' "$hash"
    if [[ -n "$keys" ]]; then
      printf '    ssh_authorized_keys:\n'
      while IFS= read -r k; do
        if [[ -n "$k" ]]; then printf '      - "%s"\n' "$k"; fi
      done <<<"$keys"
    fi
    printf 'ssh_pwauth: true\n'
    printf 'package_update: true\n'
    printf 'packages:\n'
    printf '  - qemu-guest-agent\n'
    printf 'write_files:\n'
    printf '  - path: /etc/ssh/sshd_config.d/01-provisioner.conf\n'
    printf '    permissions: "0644"\n'
    printf '    content: |\n'
    printf '      PasswordAuthentication yes\n'
    printf 'runcmd:\n'
    printf '  - [ sh, -c, "systemctl enable --now qemu-guest-agent || systemctl start qemu-guest-agent || true" ]\n'
  } >"$dir/user-data"
  printf 'instance-id: %s-%s\nlocal-hostname: %s\n' "$name" "$(date +%s)" "$name" >"$dir/meta-data"
}

vm_make_seed() {  # vm_make_seed <direktori> <iso>
  sudo cloud-localds "$2" "$1/user-data" "$1/meta-data"
}

# --- Cipta VM Linux (imej cloud + cloud-init) -----------------------------------------------------
vm_create_linux() {  # vm_create_linux <id-katalog>
  local user pass keys tmp variant autostart=0 vmip="" cred ssh_user_line key_note
  local diskimg seedimg
  vm_catalog_get "$1" || die "Imej '$1' tiada dalam katalog."
  step "Konfigurasi VM: $VM_LABEL"

  vm_ask_name "${VM_ID}-01"
  vm_ask_resources 2 2048 20
  user="$(ask "Nama pengguna dalam VM" "$VM_USER")"
  if ! [[ "$user" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then die "Nama pengguna tidak sah."; fi
  pass="$(ask_secret "Kata laluan pengguna (kosong = jana automatik)")"
  if [[ -z "$pass" ]]; then pass="$(gen_strong_password)"; note "Kata laluan dijana secara automatik."; fi
  keys="$(vm_collect_keys || true)"
  if [[ -n "$keys" ]]; then
    ok "Kunci SSH awam dijumpai ($(grep -c . <<<"$keys")) dan akan dimasukkan ke VM"
  else
    warn "Tiada kunci SSH awam dijumpai; log masuk menggunakan kata laluan sahaja."
  fi
  if ask_yn "Mulakan VM secara automatik semasa hos boot?" y; then autostart=1; fi

  step "Menyediakan imej"
  vm_fetch_image
  variant="$(pick_variant "$VM_VARIANTS")"
  diskimg="$VM_IMG_DIR/$VM_NAME.qcow2"
  seedimg="$VM_IMG_DIR/$VM_NAME-seed.iso"

  tmp="$(mktemp -d "$RUN_DIR/ci.XXXXXX")"
  vm_write_cloudinit "$tmp" "$VM_NAME" "$user" "$pass" "$VM_FAMILY" "$keys"

  run "Menyalin dan mengembangkan cakera ($VM_DISK GiB)" \
      sudo bash -c "qemu-img convert -O qcow2 '$VM_BASE_IMG' '$diskimg' && qemu-img resize '$diskimg' ${VM_DISK}G"
  run "Menjana cakera cloud-init" vm_make_seed "$tmp" "$seedimg"
  rm -rf "$tmp"

  step "Mencipta mesin maya"
  local -a cmd=(virt-install --connect qemu:///system --name "$VM_NAME" --memory "$VM_RAM" --vcpus "$VM_CPU"
                --os-variant "$variant" --import
                --disk "path=$diskimg,format=qcow2,bus=virtio"
                --disk "path=$seedimg,device=cdrom"
                --network "network=default,model=virtio"
                --graphics "vnc,listen=127.0.0.1" --noautoconsole)
  if (( VM_KVM_OK )); then cmd+=(--cpu host-passthrough); else cmd+=(--virt-type qemu --cpu max); fi
  run "Membuat dan memulakan VM '$VM_NAME' (os-variant: $variant)" sudo "${cmd[@]}"
  if (( autostart )); then virsh_ autostart "$VM_NAME" >/dev/null 2>&1 || true; fi

  rm -f "$RUN_DIR/vmip"
  try "Menunggu VM mendapat alamat IP (boleh mengambil 1-2 minit)" vm_wait_ip_file "$VM_NAME" "$RUN_DIR/vmip" 240 || true
  if [[ -s "$RUN_DIR/vmip" ]]; then
    vmip="$(<"$RUN_DIR/vmip")"
    if vm_reserve_ip "$VM_NAME" "$vmip"; then ok "IP $vmip dikunci (DHCP reservation)"; fi
  else
    warn "VM belum mendapat IP. Semak konsol: sudo virsh console $VM_NAME  atau VNC (menu 'Maklumat dan cara akses')."
  fi

  cred="$STATE_DIR/credentials/vm-$VM_NAME.txt"
  ( umask 077
    cat >"$cred" <<EOF
VM  ${VM_NAME}  -  ${VM_LABEL}  -  $(date '+%F %T')
Pengguna    : ${user}
Kata laluan : ${pass}
IP (NAT)    : ${vmip:-belum diperoleh}
Sumber      : ${VM_CPU} vCPU, ${VM_RAM} MiB RAM, ${VM_DISK} GiB cakera
Cakera      : ${diskimg}
EOF
  )
  fix_owner "$cred"

  if [[ -n "$keys" ]]; then key_note="kunci SSH + kata laluan"; else key_note="kata laluan"; fi
  printf '\n'
  ui_box "VM SEDIA: $VM_NAME" "$C_GRN" \
    "$(kv "Sistem" "$VM_LABEL")" \
    "$(kv "Sumber" "${VM_CPU} vCPU, ${VM_RAM} MiB, ${VM_DISK} GiB")" \
    "$(kv "IP (NAT)" "${vmip:-belum diperoleh}")" \
    "$(kv "Pengguna" "$user")" \
    "$(kv "Kata laluan" "$pass")" \
    "$(kv "Log masuk" "$key_note")" \
    "---" \
    "Dari hos      : ssh ${user}@${vmip:-<ip-vm>}" \
    "Dari PC anda  : ssh -J ${REAL_USER}@$(host_ip) ${user}@${vmip:-<ip-vm>}" \
    "Konsol serial : sudo virsh console ${VM_NAME}   (keluar: Ctrl+])" \
    "Akses luar    : menu 'Tambah port forward'"
  note "Kelayakan disimpan (chmod 600): $cred"
  if (( ! VM_KVM_OK )); then warn "KVM tiada: VM berjalan dalam emulasi dan akan sangat perlahan."; fi
}

# --- ISO: muat turun atau salin ke direktori libvirt --------------------------------------------------
vm_get_iso() {  # -> VM_ISO_PATH
  local src dest name size
  src="$(ask "Laluan fail ISO atau URL http(s)" "")"
  if [[ -z "$src" ]]; then die "Tiada ISO diberikan."; fi
  if [[ "$src" =~ ^https?:// ]]; then
    name="${src##*/}"; name="${name%%\?*}"
    if [[ "$name" != *.iso ]]; then name="download-$(date +%s).iso"; fi
    dest="$VM_ISO_DIR/$name"
    if sudo test -s "$dest"; then ok "ISO sudah ada: $name"; else vm_download "$src" "$dest"; fi
  else
    if [[ ! -f "$src" ]]; then die "Fail tidak dijumpai: $src"; fi
    name="${src##*/}"
    dest="$VM_ISO_DIR/$name"
    if sudo test -s "$dest"; then
      ok "ISO sudah ada dalam $VM_ISO_DIR: $name"
    else
      info "Menyalin ISO ke $VM_ISO_DIR ..."
      sudo dd if="$src" of="$dest" bs=4M status=progress
      sudo chmod 644 "$dest"
    fi
  fi
  size="$(sudo stat -c %s "$dest")"
  if (( size < 1073741824 )); then warn "Saiz ISO kurang daripada 1 GiB. Pastikan ini imej pemasangan yang betul."; fi
  VM_ISO_PATH="$dest"
}

vm_ensure_virtio_iso() {
  VIRTIO_ISO="$VM_ISO_DIR/virtio-win.iso"
  if sudo test -s "$VIRTIO_ISO"; then ok "virtio-win.iso sudah ada"; else vm_download "$VIRTIO_URL" "$VIRTIO_ISO"; fi
}

vm_pick_vnc_bind() {  # -> VM_VNC_BIND, VM_VNC_PASS
  local tsip
  VM_VNC_BIND="127.0.0.1"; VM_VNC_PASS=""
  tsip="$(tailscale_ip_now)"
  if [[ -n "$tsip" ]]; then
    ask_choice "Akses konsol VNC" 1 \
      "Localhost sahaja (selamat; guna terowong SSH)" \
      "Alamat Tailscale ${tsip} (dengan kata laluan VNC)" || return 1
    if (( CHOICE == 2 )); then VM_VNC_BIND="$tsip"; VM_VNC_PASS="$(rand_chars 'A-Za-z0-9' 10)"; fi
  fi
}

vm_press_any_key() {  # lepasi "Press any key to boot from CD or DVD" pada pemasang Windows
  local name="$1" i
  for (( i = 0; i < 25; i++ )); do
    virsh_ send-key "$name" KEY_SPACE >/dev/null 2>&1 || true
    sleep 1
  done
}

vm_win_boot_args() {  # -> VM_BOOT_ARGS (UEFI + Secure Boot jika firmware tersedia)
  local pair code vars
  VM_BOOT_ARGS=(--boot uefi)
  for pair in "/usr/share/OVMF/OVMF_CODE_4M.secboot.fd:/usr/share/OVMF/OVMF_VARS_4M.ms.fd" \
              "/usr/share/OVMF/OVMF_CODE_4M.ms.fd:/usr/share/OVMF/OVMF_VARS_4M.ms.fd" \
              "/usr/share/OVMF/OVMF_CODE.secboot.fd:/usr/share/OVMF/OVMF_VARS.ms.fd"; do
    code="${pair%%:*}"; vars="${pair##*:}"
    if [[ -f "$code" && -f "$vars" ]]; then
      VM_BOOT_ARGS=(--boot "loader=${code},loader_ro=yes,loader_type=pflash,nvram_template=${vars}" --features smm=on)
      return 0
    fi
  done
}

# Pemasangan daripada ISO. Pembolehubah diperlukan: VM_NAME VM_CPU VM_RAM VM_DISK VM_ISO_PATH VM_VARIANT
# VM_DISK_BUS VM_NIC VM_VNC_BIND VM_VNC_PASS ; tatasusunan VM_EXTRA (hujah virt-install tambahan)
vm_install_from_iso() {
  local diskimg="$VM_IMG_DIR/$VM_NAME.qcow2" graphics
  local -a cmd
  graphics="vnc,listen=${VM_VNC_BIND}"
  if [[ -n "$VM_VNC_PASS" ]]; then graphics+=",passwd=${VM_VNC_PASS}"; fi

  run "Mencipta cakera ${VM_DISK} GiB" sudo qemu-img create -f qcow2 "$diskimg" "${VM_DISK}G"
  cmd=(virt-install --connect qemu:///system --name "$VM_NAME" --memory "$VM_RAM" --vcpus "$VM_CPU"
       --os-variant "$VM_VARIANT" --cdrom "$VM_ISO_PATH"
       --disk "path=$diskimg,format=qcow2,bus=${VM_DISK_BUS}"
       --network "network=default,model=${VM_NIC}"
       --graphics "$graphics" --noautoconsole "${VM_EXTRA[@]}")
  if (( VM_KVM_OK )); then cmd+=(--cpu host-passthrough); else cmd+=(--virt-type qemu --cpu max); fi

  if [[ -n "$VM_VNC_PASS" ]]; then
    RUN_REDACT=1 run "Mencipta VM '$VM_NAME' dan memulakan pemasang" sudo "${cmd[@]}"
  else
    run "Mencipta VM '$VM_NAME' dan memulakan pemasang" sudo "${cmd[@]}"
  fi
  if (( VM_AUTOSTART )); then virsh_ autostart "$VM_NAME" >/dev/null 2>&1 || true; fi
}

vm_vnc_summary() {  # <nama>  -> VNC_PORT
  local disp
  disp="$(virsh_ vncdisplay "$1" 2>/dev/null | head -n1)"
  if [[ "$disp" =~ :([0-9]+)$ ]]; then VNC_PORT=$(( 5900 + BASH_REMATCH[1] )); else VNC_PORT=5900; fi
}

# --- Cipta VM Windows ------------------------------------------------------------------------------------
vm_create_windows() {
  local label variants tpm=0 def_ram def_cpu def_disk drv bus nic
  ask_choice "Versi Windows" 1 "Windows 11" "Windows 10" "Windows Server 2025" "Windows Server 2022" "Windows Server 2019" || return 1
  case "$CHOICE" in
    1) label="Windows 11";          variants="win11";           drv="w11";  tpm=1; def_ram=8192; def_cpu=4; def_disk=80 ;;
    2) label="Windows 10";          variants="win10";           drv="w10";         def_ram=4096; def_cpu=2; def_disk=60 ;;
    3) label="Windows Server 2025"; variants="win2k25 win2k22"; drv="2k25";        def_ram=4096; def_cpu=2; def_disk=60 ;;
    4) label="Windows Server 2022"; variants="win2k22";         drv="2k22";        def_ram=4096; def_cpu=2; def_disk=60 ;;
    *) label="Windows Server 2019"; variants="win2k19";         drv="2k19";        def_ram=4096; def_cpu=2; def_disk=60 ;;
  esac
  if (( ! VM_KVM_OK )); then
    warn "KVM tiada: Windows akan sangat perlahan."
    if ! ask_yn "Teruskan juga?" n; then return 1; fi
  fi

  step "Konfigurasi VM: $label"
  note "Anda perlu menyediakan fail ISO Windows sendiri (Windows 10/11 dan Server dari laman rasmi Microsoft)."
  note "Lesen dan pengaktifan Windows adalah tanggungjawab anda."
  vm_ask_name "$(printf '%s' "$label" | tr 'A-Z ' 'a-z-')-01"
  vm_ask_resources "$def_cpu" "$def_ram" "$def_disk"
  vm_get_iso
  vm_ensure_virtio_iso
  VM_AUTOSTART=0
  if ask_yn "Mulakan VM secara automatik semasa hos boot?" y; then VM_AUTOSTART=1; fi

  ask_choice "Mod peranti storan dan rangkaian" 1 \
    "Serasi: SATA + e1000e (tiada pemacu diperlukan semasa pemasangan)" \
    "Prestasi: VirtIO (muatkan pemacu dari CD virtio-win semasa pemasangan)" || return 1
  if (( CHOICE == 1 )); then bus="sata"; nic="e1000e"; else bus="virtio"; nic="virtio"; fi
  vm_pick_vnc_bind || return 1

  VM_VARIANT="$(pick_variant "$variants")"
  VM_DISK_BUS="$bus"; VM_NIC="$nic"
  vm_win_boot_args
  VM_EXTRA=(--disk "path=${VIRTIO_ISO},device=cdrom" "${VM_BOOT_ARGS[@]}")
  if (( tpm )); then VM_EXTRA+=(--tpm "backend.type=emulator,backend.version=2.0,model=tpm-crb"); fi

  step "Mencipta mesin maya"
  if ! vm_install_from_iso_with_fallback; then die "Gagal mencipta VM. Lihat log: $LOG_FILE"; fi
  try "Melepasi 'Press any key to boot from CD or DVD'" vm_press_any_key "$VM_NAME" || true
  vm_vnc_summary "$VM_NAME"

  local pw_line="Tiada (localhost sahaja)"
  if [[ -n "$VM_VNC_PASS" ]]; then pw_line="$VM_VNC_PASS"; fi
  printf '\n'
  ui_box "WINDOWS DIMULAKAN: $VM_NAME" "$C_GRN" \
    "$(kv "Sistem" "$label")" \
    "$(kv "Sumber" "${VM_CPU} vCPU, ${VM_RAM} MiB, ${VM_DISK} GiB")" \
    "$(kv "Konsol VNC" "${VM_VNC_BIND}:${VNC_PORT}")" \
    "$(kv "Kata VNC" "$pw_line")" \
    "---" \
    "1. Dari PC anda: ssh -L ${VNC_PORT}:127.0.0.1:${VNC_PORT} ${REAL_USER}@$(host_ip)" \
    "2. Sambung VNC viewer ke localhost:${VNC_PORT} dan ikuti pemasang Windows." \
    "3. Mod VirtIO: pada 'Where do you want to install' pilih Load driver," \
    "   lalu CD virtio-win, folder viostor\\${drv}\\amd64." \
    "4. Selepas siap: pasang virtio-win-guest-tools.exe dari CD, aktifkan" \
    "   Remote Desktop, kemudian 'Tambah port forward' (3389) untuk akses RDP." \
    "5. Keluarkan ISO melalui menu 'Keluarkan ISO' apabila pemasangan selesai."
  if (( tpm )); then note "Windows 11: jika pemasang merungut tentang TPM/Secure Boot, tekan Shift+F10 dan jalankan regedit untuk pintasan rasmi."; fi
}

vm_install_from_iso_with_fallback() {
  # Cuba dengan firmware Secure Boot; jika gagal, ulang dengan UEFI biasa.
  if ( set -e; vm_install_from_iso ); then return 0; fi
  warn "Percubaan pertama gagal; mencuba semula dengan UEFI biasa (tanpa Secure Boot)."
  virsh_ undefine "$VM_NAME" --nvram >/dev/null 2>&1 || true
  sudo rm -f "$VM_IMG_DIR/$VM_NAME.qcow2"
  VM_EXTRA=(--disk "path=${VIRTIO_ISO},device=cdrom" --boot uefi)
  if [[ "$VM_VARIANT" == win11 ]]; then VM_EXTRA+=(--tpm "backend.type=emulator,backend.version=2.0,model=tpm-crb"); fi
  ( set -e; vm_install_from_iso )
}

# --- Cipta VM daripada ISO sendiri (Linux / OS lain) ---------------------------------------------------------
vm_create_custom_iso() {
  local v
  step "Konfigurasi VM daripada ISO"
  vm_ask_name "vm-iso-01"
  vm_ask_resources 2 2048 20
  vm_get_iso
  VM_AUTOSTART=0
  if ask_yn "Mulakan VM secara automatik semasa hos boot?" y; then VM_AUTOSTART=1; fi
  v="$(ask "osinfo variant (cth ubuntu24.04, debian13, fedora41; kosong = generic)" "generic")"
  if [[ "$v" != "generic" ]] && ! osinfo_has "$v"; then
    warn "Variant '$v' tidak dikenali oleh libosinfo; menggunakan 'generic'."
    v="generic"
  fi
  vm_pick_vnc_bind || return 1
  VM_VARIANT="$v"; VM_DISK_BUS="virtio"; VM_NIC="virtio"
  VM_EXTRA=(--boot uefi)
  step "Mencipta mesin maya"
  vm_install_from_iso
  vm_vnc_summary "$VM_NAME"
  printf '\n'
  ui_box "VM DIMULAKAN: $VM_NAME" "$C_GRN" \
    "$(kv "Sumber" "${VM_CPU} vCPU, ${VM_RAM} MiB, ${VM_DISK} GiB")" \
    "$(kv "Konsol VNC" "${VM_VNC_BIND}:${VNC_PORT}")" \
    "---" \
    "Dari PC anda: ssh -L ${VNC_PORT}:127.0.0.1:${VNC_PORT} ${REAL_USER}@$(host_ip)" \
    "Sambung VNC viewer ke localhost:${VNC_PORT} dan selesaikan pemasangan OS."
}

vm_create_menu() {
  ask_choice "Jenis sistem pengendalian" 1 \
    "Ubuntu Server        (imej cloud rasmi, siap dalam ~1 minit)" \
    "Debian               (imej cloud rasmi)" \
    "Rocky / AlmaLinux    (imej cloud rasmi)" \
    "Windows              (ISO anda, pemasangan melalui konsol VNC)" \
    "Linux / OS lain      (ISO anda, pemasangan manual)" || return 0
  case "$CHOICE" in
    1) vm_pick_image '^ubuntu'       || return 0; vm_create_linux "$VM_PICK" ;;
    2) vm_pick_image '^debian'       || return 0; vm_create_linux "$VM_PICK" ;;
    3) vm_pick_image '^(rocky|alma)' || return 0; vm_create_linux "$VM_PICK" ;;
    4) vm_create_windows || return 0 ;;
    5) vm_create_custom_iso || return 0 ;;
  esac
}

#==============================================================================
#  Pengurus VM: senarai, kuasa, maklumat, port forward, keluarkan ISO, padam
#==============================================================================

vm_list_names() { virsh_ list --all --name 2>/dev/null | sed '/^$/d'; }
vm_state()      { virsh_ domstate "$1" 2>/dev/null | head -n1; }

VM_SEL=""
vm_pick() {  # -> VM_SEL ; status 1 jika tiada VM atau dibatalkan
  local n
  local -a names=() labels=()
  mapfile -t names < <(vm_list_names)
  if (( ${#names[@]} == 0 )); then warn "Belum ada VM."; return 1; fi
  for n in "${names[@]}"; do labels+=("$(printf '%-24s %s' "$n" "$(vm_state "$n")")"); done
  ask_choice "Pilih VM" 1 "${labels[@]}" || return 1
  VM_SEL="${names[CHOICE-1]}"
}

vm_list_table() {
  local n st cpu mem addr
  local -a names=()
  mapfile -t names < <(vm_list_names)
  if (( ${#names[@]} == 0 )); then note "Belum ada VM."; return 0; fi
  printf '\n  %s%-24s %-12s %-6s %-10s %s%s\n' "$C_GRY" "NAMA" "KEADAAN" "vCPU" "RAM" "IP" "$C_RST"
  for n in "${names[@]}"; do
    st="$(vm_state "$n")"
    cpu="$(virsh_ dominfo "$n" 2>/dev/null | awk '/^CPU\(s\)/ {print $2}')"
    mem="$(virsh_ dominfo "$n" 2>/dev/null | awk '/^Max memory/ {printf "%d MiB", $3 / 1024}')"
    addr="$(vm_ip_of "$n")"
    printf '  %-24s %-12s %-6s %-10s %s\n' "$n" "$st" "${cpu:--}" "${mem:--}" "${addr:--}"
  done
}

vm_power() {
  vm_pick || return 0
  ask_choice "Tindakan untuk '$VM_SEL'" 1 \
    "Mula" "Matikan (ACPI shutdown)" "Mulakan semula" "Paksa henti (cabut kuasa)" || return 0
  case "$CHOICE" in
    1) virsh_ start "$VM_SEL" >/dev/null && ok "VM '$VM_SEL' dimulakan" ;;
    2) virsh_ shutdown "$VM_SEL" >/dev/null && ok "Isyarat shutdown dihantar kepada '$VM_SEL'" ;;
    3) virsh_ reboot "$VM_SEL" >/dev/null && ok "Isyarat reboot dihantar kepada '$VM_SEL'" ;;
    4) if ask_yn "Paksa henti '$VM_SEL'? Data yang belum disimpan boleh hilang." n; then
         virsh_ destroy "$VM_SEL" >/dev/null && ok "VM '$VM_SEL' dihentikan"
       fi ;;
  esac
}

vm_info() {
  vm_pick || return 0
  local name="$VM_SEL" st addr vnc port user cred
  st="$(vm_state "$name")"
  addr="$(vm_ip_of "$name")"
  vnc="$(virsh_ vncdisplay "$name" 2>/dev/null | head -n1)"
  cred="$STATE_DIR/credentials/vm-$name.txt"
  user=""
  if [[ -r "$cred" ]]; then user="$(awk -F': ' '/^Pengguna/ {print $2; exit}' "$cred")"; fi

  local -a lines=("$(kv "Keadaan" "$st")" "$(kv "IP (NAT)" "${addr:--}")")
  if [[ "$vnc" =~ ^(.*):([0-9]+)$ ]]; then
    port=$(( 5900 + BASH_REMATCH[2] ))
    lines+=("$(kv "Konsol VNC" "${BASH_REMATCH[1]}:${port}")")
  fi
  lines+=("---")
  if [[ -n "$addr" ]]; then
    lines+=("Dari hos     : ssh ${user:-<pengguna>}@${addr}")
    lines+=("Dari PC anda : ssh -J ${REAL_USER}@$(host_ip) ${user:-<pengguna>}@${addr}")
  fi
  if [[ -n "${port:-}" ]]; then
    lines+=("Konsol VNC   : ssh -L ${port}:127.0.0.1:${port} ${REAL_USER}@$(host_ip)  ->  localhost:${port}")
  fi
  lines+=("Konsol serial: sudo virsh console ${name}   (keluar: Ctrl+])")
  printf '\n'
  ui_box "VM: $name" "$C_CYN" "${lines[@]}"
  printf '\n'
  virsh_ domblklist "$name" --details 2>/dev/null | sed 's/^/  /'
}

# --- Port forward (socat + systemd), IP VM dikunci melalui DHCP reservation -----------------------
vm_forward_add() {
  vm_pick || return 0
  local name="$VM_SEL" vmip gport hport def tsip bindaddr unit
  local -a opts=()
  vmip="$(vm_ip_of "$name")"
  if [[ -z "$vmip" ]]; then die "VM '$name' tiada alamat IP. Hidupkan VM dan tunggu ia mendapat IP."; fi
  vm_reserve_ip "$name" "$vmip" || true

  gport="$(ask "Port dalam VM (cth 22 untuk SSH, 3389 untuk RDP)" "22")"
  if ! [[ "$gport" =~ ^[0-9]{1,5}$ ]] || (( gport < 1 || gport > 65535 )); then die "Port VM tidak sah."; fi
  case "$gport" in
    22) def=2222 ;; 3389) def=33890 ;; 80) def=8080 ;; 443) def=8443 ;;
    *)  def=$(( gport + 10000 )); if (( def > 65535 )); then def=$(( gport + 1000 )); fi ;;
  esac
  hport="$(ask "Port pada hos" "$def")"
  if ! [[ "$hport" =~ ^[0-9]{1,5}$ ]] || (( hport < 1 || hport > 65535 )); then die "Port hos tidak sah."; fi
  if port_in_use "$hport"; then die "Port hos ${hport} sedang digunakan."; fi

  tsip="$(tailscale_ip_now)"
  opts=("Semua antara muka (terdedah ke internet)" "Localhost sahaja (guna terowong SSH)")
  if [[ -n "$tsip" ]]; then opts+=("Alamat Tailscale ${tsip} (disyorkan)"); fi
  ask_choice "Dengar pada" "${#opts[@]}" "${opts[@]}" || return 0
  case "$CHOICE" in
    1) bindaddr="0.0.0.0" ;;
    2) bindaddr="127.0.0.1" ;;
    *) bindaddr="$tsip" ;;
  esac

  apt_install socat
  unit="vmfwd-${name}-${hport}.service"
  put_file "/etc/systemd/system/$unit" 644 <<EOF
[Unit]
Description=Forward ${bindaddr}:${hport} -> ${name} (${vmip}:${gport})
After=network-online.target libvirtd.service
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
ExecStart=/usr/bin/socat TCP-LISTEN:${hport},bind=${bindaddr},fork,reuseaddr TCP:${vmip}:${gport}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
  run "Mengaktifkan port forward ${bindaddr}:${hport} -> ${vmip}:${gport}" \
      bash -c "sudo systemctl daemon-reload && sudo systemctl enable --now '$unit'"

  if [[ "$bindaddr" == "0.0.0.0" ]]; then
    fw_allow "${hport}/tcp" "VM forward ${name}"
    warn "Port ${hport} terdedah ke internet. Gunakan kata laluan kuat atau pertimbangkan Tailscale."
  elif [[ "$bindaddr" == "$tsip" && -n "$tsip" ]] && command_exists ufw; then
    sudo ufw allow in on tailscale0 to any port "$hport" proto tcp comment "VM forward ${name}" >>"$LOG_FILE" 2>&1 || true
  fi

  printf '\n'
  ok "Sambung ke: ${bindaddr/0.0.0.0/$(host_ip)}:${hport}"
  if (( gport == 22 )); then note "SSH : ssh -p ${hport} <pengguna>@${bindaddr/0.0.0.0/$(host_ip)}"; fi
  if (( gport == 3389 )); then note "RDP : mstsc /v:${bindaddr/0.0.0.0/$(host_ip)}:${hport}"; fi
}

vm_forward_manage() {
  local u d
  local -a units=() labels=()
  mapfile -t units < <(systemctl list-unit-files 'vmfwd-*.service' --no-legend 2>/dev/null | awk '{print $1}')
  if (( ${#units[@]} == 0 )); then note "Tiada port forward dikonfigurasi."; return 0; fi
  for u in "${units[@]}"; do
    d="$(systemctl cat "$u" 2>/dev/null | awk -F= '/^Description=/ {print $2; exit}')"
    labels+=("$d  [$(systemctl is-active "$u" 2>/dev/null || true)]")
  done
  ask_choice "Port forward (pilih untuk membuang)" 0 "${labels[@]}" || return 0
  u="${units[CHOICE-1]}"
  if ask_yn "Buang ${u}?" y; then
    sudo systemctl disable --now "$u" >>"$LOG_FILE" 2>&1 || true
    sudo rm -f "/etc/systemd/system/$u"
    sudo systemctl daemon-reload
    ok "Dibuang: $u"
    note "Jika peraturan UFW telah ditambah, buang dengan: sudo ufw status numbered  /  sudo ufw delete <no>"
  fi
}

vm_eject() {
  vm_pick || return 0
  local tgt flags="--config" n=0
  if [[ "$(vm_state "$VM_SEL")" == "running" ]]; then flags="--live --config"; fi
  while read -r tgt; do
    if [[ -z "$tgt" ]]; then continue; fi
    # shellcheck disable=SC2086
    if virsh_ change-media "$VM_SEL" "$tgt" --eject $flags >/dev/null 2>&1; then n=$(( n + 1 )); fi
  done < <(virsh_ domblklist "$VM_SEL" --details 2>/dev/null | awk '$2 == "cdrom" {print $3}')
  ok "Media dikeluarkan daripada ${n} pemacu CD-ROM pada '$VM_SEL'"
}

vm_delete() {
  vm_pick || return 0
  local name="$VM_SEL" confirm d u
  local -a disks=()
  warn "VM '$name' dan cakera-nya akan dipadam secara kekal."
  confirm="$(ask "Taip nama VM untuk mengesahkan" "")"
  if [[ "$confirm" != "$name" ]]; then note "Dibatalkan."; return 0; fi

  mapfile -t disks < <(virsh_ domblklist "$name" --details 2>/dev/null | awk '$1 == "file" && $2 == "disk" {print $4}')
  if [[ "$(vm_state "$name")" == "running" ]]; then virsh_ destroy "$name" >/dev/null 2>&1 || true; fi

  for u in $(systemctl list-unit-files "vmfwd-${name}-*.service" --no-legend 2>/dev/null | awk '{print $1}'); do
    sudo systemctl disable --now "$u" >>"$LOG_FILE" 2>&1 || true
    sudo rm -f "/etc/systemd/system/$u"
  done

  virsh_ undefine "$name" --nvram --managed-save --snapshots-metadata --tpm >/dev/null 2>&1 \
    || virsh_ undefine "$name" --nvram --managed-save --snapshots-metadata >/dev/null 2>&1 \
    || virsh_ undefine "$name" --managed-save --snapshots-metadata >/dev/null
  for d in "${disks[@]}"; do
    if [[ "$d" == "$VM_IMG_DIR"/* ]]; then sudo rm -f "$d"; fi
  done
  sudo rm -f "$VM_IMG_DIR/$name-seed.iso"
  sudo systemctl daemon-reload
  ok "VM '$name' dipadam"
}

# --- Modul --------------------------------------------------------------------------------------------
module_vm() {
  hdr "MODUL $(mod_no vm)" "Mesin Maya (KVM)"
  kvm_host_setup

  if (( ASSUME_YES )); then
    ok "Mod tidak interaktif: hos KVM sedia. Jalankan semula tanpa -y untuk mencipta VM."
    return 0
  fi

  while true; do
    ISO_RC=0
    ask_choice "Pengurus mesin maya   (Enter = kembali)" 0 \
      "Cipta VM baharu" \
      "Senarai VM" \
      "Kuasa VM (mula, matikan, mulakan semula)" \
      "Maklumat dan cara akses" \
      "Tambah port forward" \
      "Urus port forward" \
      "Keluarkan ISO (selepas pemasangan OS)" \
      "Padam VM" || break
    case "$CHOICE" in
      1) isolate vm_create_menu ;;
      2) vm_list_table ;;
      3) isolate vm_power ;;
      4) isolate vm_info ;;
      5) isolate vm_forward_add ;;
      6) isolate vm_forward_manage ;;
      7) isolate vm_eject ;;
      8) isolate vm_delete ;;
    esac
    if (( ISO_RC != 0 )); then warn "Operasi tidak selesai (lihat mesej di atas)."; fi
  done
}

#==============================================================================
#  MODUL: Pterodactyl Wings
#  Mengikut panduan rasmi: https://pterodactyl.io/wings/1.0/installing.html
#==============================================================================

WINGS_BIN="/usr/local/bin/wings"
WINGS_DIR="/etc/pterodactyl"
WINGS_CFG="/etc/pterodactyl/config.yml"
WINGS_UNIT="/etc/systemd/system/wings.service"

wings_arch() {
  case "$(uname -m)" in
    x86_64)        printf 'amd64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *) return 1 ;;
  esac
}

wings_ports() {  # -> "<port-api> <port-sftp>" (dibaca daripada config.yml jika ada)
  local api="" sftp=""
  if sudo test -f "$WINGS_CFG"; then
    api="$(sudo awk '/^api:/ {f = 1; next} /^[^ #]/ {f = 0} f && $1 == "port:" {print $2; exit}' "$WINGS_CFG" | tr -d "\"'")"
    sftp="$(sudo awk '$1 == "bind_port:" {print $2; exit}' "$WINGS_CFG" | tr -d "\"'")"
  fi
  printf '%s %s\n' "${api:-8080}" "${sftp:-2022}"
}

wings_wait_port() {  # wings_wait_port <port> <had-saat>
  local port="$1" timeout="$2" deadline
  deadline=$(( $(date +%s) + timeout ))
  while (( $(date +%s) < deadline )); do
    if port_in_use "$port"; then return 0; fi
    sleep 2
  done
  return 1
}

wings_preflight() {
  local virt kern cores ram disk
  if ! wings_arch >/dev/null; then die "Seni bina $(uname -m) tidak disokong oleh Wings."; fi
  virt="$(systemd-detect-virt 2>/dev/null || true)"
  case "$virt" in
    openvz|lxc|lxc-libvirt|docker|podman|systemd-nspawn|wsl)
      die "Virtualisasi '$virt' biasanya tidak boleh menjalankan Docker/Wings. Gunakan KVM atau dedicated server." ;;
  esac
  kern="$(uname -r)"
  if [[ "$kern" =~ -(grs|mod-std)-ipv6-64$ ]]; then
    warn "Kernel '$kern' diubah suai oleh penyedia dan mungkin tidak menyokong semua ciri Docker."
  fi
  cores="$(nproc)"
  ram="$(awk '/MemTotal/ {printf "%.1f", $2 / 1048576}' /proc/meminfo)"
  disk="$(df -h --output=avail /var 2>/dev/null | tail -n1 | tr -d ' ')"
  printf '\n'
  ui_box "KEPERLUAN WINGS" "$C_CYN" \
    "$(kv "CPU" "${cores} teras")" \
    "$(kv "RAM" "${ram} GiB")" \
    "$(kv "Cakera /var" "${disk} bebas (data pelayan: /var/lib/pterodactyl)")" \
    "$(kv "Virtualisasi" "${virt:-none}")" \
    "$(kv "Kernel" "$kern")"
  if awk -v r="$ram" 'BEGIN { exit !(r < 1) }'; then warn "RAM kurang daripada 1 GiB; pelayan permainan akan terhad."; fi
}

wings_enable_swapaccount() {
  local f="/etc/default/grub"
  if [[ ! -f "$f" ]]; then warn "$f tiada; tetapkan swapaccount=1 secara manual mengikut bootloader anda."; return 1; fi
  if grep -q 'swapaccount=1' "$f"; then ok "swapaccount=1 sudah ada dalam GRUB"; return 0; fi
  sudo cp -a "$f" "$f.bak.$(date +%Y%m%d%H%M%S)"
  sudo sed -i -E 's/^(GRUB_CMDLINE_LINUX_DEFAULT=")([^"]*)(")/\1\2 swapaccount=1\3/' "$f"
  if ! grep -q 'swapaccount=1' "$f"; then
    warn "Tidak dapat mengubah GRUB_CMDLINE_LINUX_DEFAULT secara automatik. Tambah 'swapaccount=1' secara manual."
    return 1
  fi
  run "Mengemas kini GRUB" sudo update-grub
  warn "Reboot diperlukan supaya had swap berkuat kuasa."
}

wings_swap_check() {
  if sudo docker info 2>&1 | grep -qi 'no swap limit support'; then
    warn "Docker melaporkan: tiada sokongan had swap."
    note "Pilihan, disyorkan jika anda menjual hos kepada orang lain. Memerlukan reboot."
    if ask_yn "Tambah swapaccount=1 ke GRUB sekarang?" n; then wings_enable_swapaccount || true; fi
  else
    ok "Docker menyokong had swap"
  fi
}

wings_install_binary() {
  local arch url
  arch="$(wings_arch)"
  url="https://github.com/pterodactyl/wings/releases/latest/download/wings_linux_${arch}"
  sudo mkdir -p "$WINGS_DIR"
  run "Memuat turun Wings (linux/${arch})" curl -fL --retry 3 -o "$RUN_DIR/wings" "$url"
  run "Memasang binari Wings" sudo install -m 0755 "$RUN_DIR/wings" "$WINGS_BIN"
  ok "Versi: $(sudo "$WINGS_BIN" --version 2>/dev/null | head -n1 || echo tidak-diketahui)"
}

wings_write_service() {
  put_file "$WINGS_UNIT" 644 <<'UNIT'
[Unit]
Description=Pterodactyl Wings Daemon
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
User=root
WorkingDirectory=/etc/pterodactyl
LimitNOFILE=4096
PIDFile=/var/run/wings/daemon.pid
ExecStart=/usr/local/bin/wings
Restart=on-failure
StartLimitInterval=180
StartLimitBurst=30
RestartSec=5s

[Install]
WantedBy=multi-user.target
UNIT
  run "Memuat semula systemd" sudo systemctl daemon-reload
}

# --- Konfigurasi node ---------------------------------------------------------------------------------
WG_URL=""; WG_TOKEN=""; WG_NODE=""; WG_INSECURE=0

wings_parse_cmd() {  # ekstrak --panel-url, --token, --node daripada arahan yang ditampal
  local -a w=()
  local i
  read -ra w <<<"$1"
  for (( i = 0; i < ${#w[@]}; i++ )); do
    case "${w[i]}" in
      --panel-url|-p)   WG_URL="${w[i+1]:-}" ;;
      --panel-url=*)    WG_URL="${w[i]#*=}" ;;
      --token|-t)       WG_TOKEN="${w[i+1]:-}" ;;
      --token=*)        WG_TOKEN="${w[i]#*=}" ;;
      --node)           WG_NODE="${w[i+1]:-}" ;;
      --node=*)         WG_NODE="${w[i]#*=}" ;;
      --allow-insecure) WG_INSECURE=1 ;;
    esac
  done
  WG_URL="$(printf '%s' "$WG_URL" | tr -d "\"'")"
  WG_TOKEN="$(printf '%s' "$WG_TOKEN" | tr -d "\"'")"
  WG_NODE="$(printf '%s' "$WG_NODE" | tr -d "\"'")"
  WG_URL="${WG_URL%/}"
}

wings_configure() {
  local cmd
  local -a args=()
  WG_URL=""; WG_TOKEN=""; WG_NODE=""; WG_INSECURE=0

  note "Di Panel: Admin > Nodes > (node anda) > Configuration > Generate Token."
  note "Salin arahan penuh yang dipaparkan dan tampal di bawah, atau tekan Enter untuk isi manual."
  cmd="$(ask "Arahan 'wings configure'" "")"
  if [[ -n "$cmd" ]]; then wings_parse_cmd "$cmd"; fi

  if [[ -z "$WG_URL" ]]; then WG_URL="$(ask "URL Panel (cth https://panel.contoh.com; kosong = langkau)" "")"; WG_URL="${WG_URL%/}"; fi
  if [[ -z "$WG_URL" ]]; then
    warn "Konfigurasi dilangkau. Selepas node dicipta di Panel, jalankan semula modul ini."
    return 1
  fi
  if ! [[ "$WG_URL" =~ ^https?://[^[:space:]]+$ ]]; then warn "URL Panel tidak sah: $WG_URL"; return 1; fi
  if [[ -z "$WG_TOKEN" ]]; then WG_TOKEN="$(ask_secret "Token node (ptla_...)")"; fi
  if [[ -z "$WG_NODE" ]];  then WG_NODE="$(ask "ID node" "1")"; fi
  if [[ -z "$WG_TOKEN" ]] || ! [[ "$WG_NODE" =~ ^[0-9]+$ ]]; then warn "Token kosong atau ID node tidak sah."; return 1; fi
  if [[ "$WG_URL" == https://* ]] && (( WG_INSECURE == 0 )); then
    if ask_yn "Panel menggunakan sijil self-signed (langkau pengesahan TLS)?" n; then WG_INSECURE=1; fi
  fi

  if sudo test -f "$WINGS_CFG"; then
    sudo cp -a "$WINGS_CFG" "$WINGS_CFG.bak.$(date +%Y%m%d%H%M%S)"
    sudo rm -f "$WINGS_CFG"
    note "Konfigurasi lama disandarkan (config.yml.bak.*)."
  fi

  args=(configure --panel-url "$WG_URL" --token "$WG_TOKEN" --node "$WG_NODE")
  if (( WG_INSECURE )); then args+=(--allow-insecure); fi
  if RUN_REDACT=1 try "Mengambil konfigurasi daripada Panel" \
       sudo bash -c 'cd /etc/pterodactyl && exec "$@"' _ "$WINGS_BIN" "${args[@]}"; then
    sudo chmod 600 "$WINGS_CFG" 2>/dev/null || true
    ok "Konfigurasi ditulis: $WINGS_CFG"
    if [[ -f "$WINGS_PROXY_MARK" ]]; then wings_patch_proxy; fi
    return 0
  fi
  warn "Gagal mengambil konfigurasi. Semak: URL Panel boleh dicapai dari pelayan ini, token masih sah, dan ID node betul."
  return 1
}

# --- Sijil SSL (Let's Encrypt, kaedah standalone) -------------------------------------------------------
wings_ssl() {
  local fqdn email
  local -a args=()
  fqdn="$(ask "Domain (FQDN) node untuk sijil SSL (kosong = langkau)" "")"
  if [[ -z "$fqdn" ]]; then note "Sijil SSL dilangkau."; return 0; fi
  if ! valid_fqdn "$fqdn"; then warn "Format domain tidak sah: $fqdn"; return 0; fi
  dns_check_confirm "$fqdn" || return 0
  if port_in_use 80; then
    warn "Port 80 sedang digunakan. Hentikan perkhidmatan itu seketika atau gunakan 'certbot --webroot'."
    return 0
  fi

  email="$(ask "E-mel untuk notis Let's Encrypt (kosong = tanpa e-mel)" "")"
  apt_install certbot
  fw_allow "80/tcp" "certbot (pembaharuan sijil)"
  args=(certonly --standalone -d "$fqdn" --non-interactive --agree-tos --keep-until-expiring)
  if [[ -n "$email" ]]; then args+=(-m "$email"); else args+=(--register-unsafely-without-email); fi
  if ! try "Mendapatkan sijil Let's Encrypt untuk $fqdn" sudo certbot "${args[@]}"; then
    warn "Gagal. Pastikan DNS betul dan port 80 boleh dicapai dari internet. Log: $LOG_FILE"
    return 0
  fi
  put_file /etc/letsencrypt/renewal-hooks/deploy/wings-restart.sh 755 <<'HOOK'
#!/bin/sh
systemctl restart wings 2>/dev/null || true
HOOK
  ok "Sijil: /etc/letsencrypt/live/${fqdn}/ (pembaharuan automatik; Wings dimulakan semula selepas diperbaharui)"
  note "Dalam Panel: FQDN node = ${fqdn} dan 'Communicate Over SSL' = Use SSL Connection."
}

# --- Wings di belakang proksi / Cloudflare Tunnel --------------------------------------------------------
WINGS_PROXY_MARK="$STATE_DIR/wings-proxy-mode"

wings_patch_proxy() {  # config.yml: api.port=8080 dan api.ssl.enabled=false (SSL ditamatkan oleh proksi)
  local tmp
  if ! sudo test -f "$WINGS_CFG"; then return 0; fi
  tmp="$(mktemp)"
  sudo cat "$WINGS_CFG" | awk '
    /^[^ #]/ { sect = $1; sub(/:$/, "", sect); sub_sect = "" }
    sect == "api" && /^  [a-z_]+:/ { sub_sect = $1; sub(/:$/, "", sub_sect) }
    sect == "api" && /^  port:/ { print "  port: 8080"; next }
    sect == "api" && sub_sect == "ssl" && /^    enabled:/ { print "    enabled: false"; next }
    { print }
  ' >"$tmp"
  sudo install -m 600 "$tmp" "$WINGS_CFG"
  rm -f "$tmp"
  ok "config.yml dilaraskan untuk mod proksi (api.port 8080, SSL tempatan dimatikan)"
}

wings_tunnel() {
  note "Wings dicapai melalui Cloudflare Tunnel: SSL ditamatkan oleh Cloudflare, tiada sijil tempatan."
  cloudflared_install
  if ! cloudflared_connect; then warn "Tunnel tidak aktif; mod proksi tidak ditetapkan."; return 0; fi
  ( umask 077; printf 'proxy\n' >"$WINGS_PROXY_MARK" )
  wings_patch_proxy
  printf '\n'
  ui_box "WINGS MELALUI TUNNEL" "$C_CYN" \
    "Cloudflare > Tunnels > Public Hostname > Add:" \
    "   wings.domain-anda.com   Service: HTTP   127.0.0.1:8080" \
    "---" \
    "Dalam Panel (Node):" \
    "   FQDN = wings.domain-anda.com, Communicate Over SSL = Use SSL," \
    "   Behind Proxy = Yes, Daemon Port = 443, SFTP Port = 2022" \
    "---" \
    "SFTP (2022) dan port permainan tidak melalui tunnel. Untuk SFTP gunakan" \
    "rekod DNS tanpa proksi (DNS only) yang menuju ke IP pelayan ini."
}

# --- Firewall, permulaan, ringkasan -----------------------------------------------------------------------
wings_firewall() {
  local api sftp
  read -r api sftp < <(wings_ports)
  if command_exists ufw; then
    fw_allow "${api}/tcp" "Pterodactyl Wings API"
    fw_allow "${sftp}/tcp" "Pterodactyl Wings SFTP"
    ok "UFW: dibuka ${api}/tcp (API) dan ${sftp}/tcp (SFTP)"
  else
    note "UFW tidak dipasang. Pastikan ${api}/tcp dan ${sftp}/tcp boleh dicapai (firewall penyedia atau modul Firewall)."
  fi
  note "Port pelayan permainan (cth 25565) dibuka mengikut Allocation yang anda cipta dalam Panel."
}

wings_start() {
  local api sftp
  run "Mengaktifkan perkhidmatan Wings (auto-mula)" sudo systemctl enable wings
  if ! sudo test -f "$WINGS_CFG"; then
    warn "config.yml belum wujud; Wings belum dimulakan."
    note "Selepas node dicipta di Panel, jalankan semula modul ini dan pilih 'Konfigurasi semula'."
    return 0
  fi
  run "Memulakan Wings" sudo systemctl restart wings
  read -r api sftp < <(wings_ports)
  if try "Menunggu Wings mendengar pada port ${api}" wings_wait_port "$api" 40; then
    ok "Wings aktif dan mendengar pada ${api}/tcp"
  else
    warn "Wings belum mendengar. Semak log: journalctl -u wings -n 50 --no-pager"
    sudo journalctl -u wings -n 8 --no-pager 2>/dev/null | sed 's/^/        /' || true
  fi
}

wings_summary() {
  local api sftp ver cfg_state svc
  read -r api sftp < <(wings_ports)
  ver="$(sudo "$WINGS_BIN" --version 2>/dev/null | head -n1 || echo -)"
  if sudo test -f "$WINGS_CFG"; then cfg_state="ada"; else cfg_state="belum (perlu dari Panel)"; fi
  if systemctl is-active --quiet wings 2>/dev/null; then svc="aktif"; else svc="belum aktif"; fi
  printf '\n'
  ui_box "WINGS" "$C_GRN" \
    "$(kv "Binari" "$WINGS_BIN  (${ver})")" \
    "$(kv "Konfigurasi" "$WINGS_CFG: ${cfg_state}")" \
    "$(kv "Port" "API ${api}/tcp, SFTP ${sftp}/tcp")" \
    "$(kv "Perkhidmatan" "$svc")" \
    "---" \
    "Langkah di Panel:" \
    " 1. Admin > Nodes > Create New (FQDN, SSL, memori dan cakera)" \
    " 2. Tab Configuration > Generate Token, jalankan semula modul ini" \
    " 3. Tab Allocation: tambah IP $(host_ip) dan port pelayan permainan" \
    "    (jangan guna 127.0.0.1)" \
    "---" \
    "Status : systemctl status wings" \
    "Log    : journalctl -u wings -f" \
    "Laporan: sudo wings diagnostics"
}

wings_status() {
  sudo systemctl status wings --no-pager -n 15 2>&1 | sed 's/^/  /' || true
  note "Log langsung: journalctl -u wings -f"
  if ask_yn "Jalankan 'wings diagnostics' (laporan untuk sokongan)?" n; then
    sudo "$WINGS_BIN" diagnostics || true
  fi
}

wings_menu_existing() {
  local v
  v="$(sudo "$WINGS_BIN" --version 2>/dev/null | head -n1 || true)"
  ok "Wings sudah dipasang${v:+ ($v)}"
  ask_choice "Pengurusan Wings   (Enter = keluar)" 0 \
    "Kemas kini binari ke versi terkini" \
    "Konfigurasi semula node (wings configure)" \
    "Dapatkan sijil SSL (Let's Encrypt)" \
    "Sambung melalui Cloudflare Tunnel (mod proksi)" \
    "Status dan diagnostik" || return 0
  case "$CHOICE" in
    1) wings_install_binary
       if sudo test -f "$WINGS_CFG"; then run "Memulakan semula Wings" sudo systemctl restart wings; fi ;;
    2) wings_configure && wings_start || true ;;
    3) wings_ssl ;;
    4) wings_tunnel; if sudo test -f "$WINGS_CFG"; then run "Memulakan semula Wings" sudo systemctl restart wings; fi ;;
    5) wings_status ;;
  esac
}

module_wings() {
  hdr "MODUL $(mod_no wings)" "Pterodactyl Wings"
  wings_preflight

  if [[ -x "$WINGS_BIN" ]]; then
    wings_menu_existing
    return 0
  fi

  step "1/6  Docker"
  docker_ensure

  step "2/6  Had swap Docker"
  wings_swap_check

  step "3/6  Binari dan perkhidmatan Wings"
  wings_install_binary
  wings_write_service

  step "4/6  Akses HTTPS"
  note "Jika Panel anda menggunakan HTTPS, Wings juga mesti dicapai melalui HTTPS."
  ask_choice "Bagaimana Wings dicapai oleh Panel dan pelayar?" 1 \
    "Let's Encrypt        domain menuju terus ke pelayan ini (port 80 diperlukan)" \
    "Cloudflare Tunnel    di belakang proksi, tiada sijil tempatan (token diminta terus)" \
    "Langkau              guna HTTP atau uruskan sendiri" || CHOICE=3
  rm -f "$WINGS_PROXY_MARK"
  case "$CHOICE" in
    1) wings_ssl ;;
    2) wings_tunnel ;;
    *) note "Dilangkau." ;;
  esac

  step "5/6  Konfigurasi node"
  wings_configure || true

  step "6/6  Firewall dan permulaan"
  wings_firewall
  wings_start
  wings_summary
}

#==============================================================================
#  MODUL: Pterodactyl Panel
#  Mengikut panduan rasmi: https://pterodactyl.io/panel/1.0/getting_started.html
#  Mod akses: Cloudflare Tunnel (token diminta terus), Let's Encrypt, atau HTTP.
#==============================================================================

PANEL_DIR="/var/www/pterodactyl"
PANEL_PHP=""

panel_artisan() { sudo bash -c 'cd /var/www/pterodactyl && exec php artisan "$@"' _ "$@"; }

panel_env_set() {  # panel_env_set KUNCI NILAI  -> kemas kini atau tambah dalam .env
  local k="$1" v="$2" f="$PANEL_DIR/.env" tmp
  tmp="$(mktemp)"
  sudo cat "$f" | awk -v k="$k" -v v="$v" '
    BEGIN { FS = OFS = "=" }
    $1 == k { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' >"$tmp"
  sudo install -m 640 -o www-data -g www-data "$tmp" "$f"
  rm -f "$tmp"
}

panel_pick_php() {  # versi PHP yang disokong (8.3 diutamakan, kemudian 8.2) daripada repositori semasa
  local v
  for v in 8.3 8.2; do
    if apt_available "php${v}-fpm"; then printf '%s' "$v"; return 0; fi
  done
  return 1
}

panel_add_php_repo_exec() {  # repositori PHP tambahan (Ondrej PPA / Sury) bila PHP 8.2 atau 8.3 tiada dalam distro
  local id
  id="$(. /etc/os-release && printf '%s' "$ID")"
  case "$id" in
    ubuntu)
      sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq software-properties-common
      sudo env LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php ;;
    debian)
      sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq lsb-release ca-certificates curl
      sudo curl -fsSLo "$RUN_DIR/debsuryorg-archive-keyring.deb" https://packages.sury.org/debsuryorg-archive-keyring.deb
      sudo dpkg -i "$RUN_DIR/debsuryorg-archive-keyring.deb"
      printf 'deb [signed-by=/usr/share/keyrings/debsuryorg-archive-keyring.gpg] https://packages.sury.org/php/ %s main\n' "$(lsb_release -sc)" \
        | sudo tee /etc/apt/sources.list.d/php.list >/dev/null ;;
    *) return 1 ;;
  esac
  sudo apt-get update -qq
}

panel_install_deps() {
  apt_refresh_once
  PANEL_PHP="$(panel_pick_php || true)"
  if [[ -z "$PANEL_PHP" ]]; then
    warn "Repositori distro tidak menyediakan PHP 8.2/8.3 (diperlukan Panel). Menambah repositori PHP tambahan."
    run "Menambah repositori PHP (Ondrej / Sury)" panel_add_php_repo_exec
    PANEL_PHP="$(panel_pick_php || true)"
    if [[ -z "$PANEL_PHP" ]]; then die "PHP 8.2/8.3 tidak dapat dipasang pada sistem ini."; fi
  fi
  ok "PHP dipilih: ${PANEL_PHP}"
  apt_install "php${PANEL_PHP}-cli" "php${PANEL_PHP}-fpm" "php${PANEL_PHP}-common" "php${PANEL_PHP}-gd" \
              "php${PANEL_PHP}-mysql" "php${PANEL_PHP}-mbstring" "php${PANEL_PHP}-bcmath" "php${PANEL_PHP}-xml" \
              "php${PANEL_PHP}-curl" "php${PANEL_PHP}-zip" \
              mariadb-server nginx redis-server tar unzip git curl cron
  run "Mengaktifkan MariaDB, Redis dan PHP-FPM" \
      sudo systemctl enable --now mariadb redis-server "php${PANEL_PHP}-fpm"
}

panel_install_composer() {
  local expected actual setup="$RUN_DIR/composer-setup.php"
  if command_exists composer; then ok "Composer sudah dipasang ($(composer --version 2>/dev/null | head -n1))"; return 0; fi
  expected="$(curl -fsSL https://composer.github.io/installer.sig | tr -d '[:space:]')"
  run "Memuat turun pemasang Composer" curl -fsSL https://getcomposer.org/installer -o "$setup"
  actual="$(sha384sum "$setup" | awk '{print $1}')"
  if [[ -z "$expected" || "$actual" != "$expected" ]]; then
    rm -f "$setup"
    die "Tandatangan pemasang Composer tidak sah; pemasangan dihentikan."
  fi
  run "Memasang Composer" sudo php "$setup" --install-dir=/usr/local/bin --filename=composer
}

panel_setup_db() {  # panel_setup_db <kata-laluan-db>
  local sql="$RUN_DIR/panel-db.sql" cli
  cli="$(command -v mariadb || command -v mysql || true)"
  if [[ -z "$cli" ]]; then die "Klien MariaDB/MySQL tidak dijumpai."; fi
  ( umask 077
    cat >"$sql" <<EOF
CREATE DATABASE IF NOT EXISTS panel;
CREATE USER IF NOT EXISTS 'pterodactyl'@'127.0.0.1' IDENTIFIED BY '$1';
ALTER USER 'pterodactyl'@'127.0.0.1' IDENTIFIED BY '$1';
GRANT ALL PRIVILEGES ON panel.* TO 'pterodactyl'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
EOF
  )
  RUN_REDACT=1 run "Mencipta pangkalan data 'panel' dan pengguna 'pterodactyl'" sudo bash -c "'$cli' < '$sql'"
  rm -f "$sql"
}

panel_write_nginx() {  # panel_write_nginx <mod: tunnel|ssl|http> <fqdn>
  local mode="$1" fqdn="$2" listen name realip="" https=""
  local conf
  case "$mode" in
    tunnel)
      listen="listen 127.0.0.1:80;"; name="$fqdn"
      realip=$'\n    # Trafik datang daripada cloudflared (localhost); gunakan IP pelawat sebenar.\n    set_real_ip_from 127.0.0.1;\n    real_ip_header CF-Connecting-IP;\n'
      https="        fastcgi_param HTTPS on;" ;;
    ssl)  listen="listen 80;"; name="$fqdn" ;;
    *)    listen="listen 80;"; name="_" ;;
  esac
  conf="$(cat <<'NGINX'
server {
    @@LISTEN@@
    server_name @@NAME@@;

    root /var/www/pterodactyl/public;
    index index.html index.htm index.php;
    charset utf-8;
@@REALIP@@
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    access_log off;
    error_log  /var/log/nginx/pterodactyl.app-error.log error;

    # allow larger file uploads and longer script runtimes
    client_max_body_size 100m;
    client_body_timeout 120s;

    sendfile off;

    location ~ \.php$ {
        fastcgi_split_path_info ^(.+\.php)(/.+)$;
        fastcgi_pass unix:/run/php/php@@PHP@@-fpm.sock;
        fastcgi_index index.php;
        include /etc/nginx/fastcgi_params;
        fastcgi_param PHP_VALUE "upload_max_filesize = 100M \n post_max_size=100M";
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param HTTP_PROXY "";
@@HTTPS@@
        fastcgi_intercept_errors off;
        fastcgi_buffer_size 16k;
        fastcgi_buffers 4 16k;
        fastcgi_connect_timeout 300;
        fastcgi_send_timeout 300;
        fastcgi_read_timeout 300;
    }

    location ~ /\.ht {
        deny all;
    }
}
NGINX
)"
  conf="${conf//@@LISTEN@@/$listen}"
  conf="${conf//@@NAME@@/$name}"
  conf="${conf//@@REALIP@@/$realip}"
  conf="${conf//@@HTTPS@@/$https}"
  conf="${conf//@@PHP@@/$PANEL_PHP}"
  printf '%s\n' "$conf" | put_file /etc/nginx/sites-available/pterodactyl.conf 644
  sudo ln -sf /etc/nginx/sites-available/pterodactyl.conf /etc/nginx/sites-enabled/pterodactyl.conf
  sudo rm -f /etc/nginx/sites-enabled/default
}

panel_health() {  # panel_health [host]
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "Host: ${1:-localhost}" http://127.0.0.1/ || true)"
  [[ "$code" =~ ^(200|301|302)$ ]]
}

panel_make_admin() {  # <emel> <pengguna> <nama-pertama> <nama-akhir> <kata-laluan>
  RUN_REDACT=1 run "Mencipta pengguna admin '$2'" \
    panel_artisan p:user:make --email="$1" --username="$2" --name-first="$3" --name-last="$4" --password="$5" --admin=1
}

AD_EMAIL=""; AD_USER=""; AD_FIRST=""; AD_LAST=""; AD_PASS=""
panel_ask_admin() {  # -> AD_*
  AD_EMAIL="$(ask "E-mel admin" "")"
  if ! [[ "$AD_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then die "Alamat e-mel tidak sah."; fi
  AD_USER="$(ask "Nama pengguna admin" "admin")"
  if ! [[ "$AD_USER" =~ ^[A-Za-z0-9_.-]{3,64}$ ]]; then die "Nama pengguna tidak sah (3-64 aksara: huruf, nombor, . _ -)."; fi
  AD_FIRST="$(ask "Nama pertama" "Admin")"
  AD_LAST="$(ask "Nama akhir" "User")"
  AD_PASS="$(ask_secret "Kata laluan admin (kosong = jana automatik)")"
  if [[ -z "$AD_PASS" ]]; then
    AD_PASS="$(gen_strong_password)"; note "Kata laluan admin dijana secara automatik."
  elif (( ${#AD_PASS} < 8 )) || ! [[ "$AD_PASS" =~ [a-z] && "$AD_PASS" =~ [A-Z] && "$AD_PASS" =~ [0-9] ]]; then
    die "Kata laluan mesti sekurang-kurangnya 8 aksara dengan huruf besar, huruf kecil dan nombor."
  fi
}

panel_menu_existing() {
  local svc
  ok "Panel sudah dipasang di $PANEL_DIR"
  ask_choice "Pengurusan Panel   (Enter = keluar)" 0 \
    "Cipta pengguna admin baharu" \
    "Semak status perkhidmatan" || return 0
  case "$CHOICE" in
    1) panel_ask_admin; panel_make_admin "$AD_EMAIL" "$AD_USER" "$AD_FIRST" "$AD_LAST" "$AD_PASS"
       ok "Admin '$AD_USER' dicipta. Kata laluan: $AD_PASS" ;;
    2) for svc in nginx mariadb redis-server pteroq cloudflared; do
         if systemctl cat "$svc" >/dev/null 2>&1; then
           printf '  %-14s %s\n' "$svc" "$(systemctl is-active "$svc" 2>/dev/null || true)"
         fi
       done ;;
  esac
}

module_panel() {
  local mode fqdn url tz dbpass appkey cred email_ssl status_line
  hdr "MODUL $(mod_no panel)" "Pterodactyl Panel"

  if (( ASSUME_YES )); then
    skip_module "Modul ini memerlukan input interaktif (domain, token tunnel, akaun admin). Jalankan tanpa -y."
  fi
  if [[ -f "$PANEL_DIR/artisan" ]]; then panel_menu_existing; return 0; fi

  # ---- Maklumat yang diperlukan (semua ditanya di awal) ---------------------------------
  ask_choice "Bagaimana Panel akan diakses?" 1 \
    "Cloudflare Tunnel     disyorkan: tiada port dibuka, SSL oleh Cloudflare (token diminta terus)" \
    "Domain + Let's Encrypt  domain menuju terus ke pelayan ini (port 80 dan 443)" \
    "HTTP sahaja           IP atau ujian, tanpa SSL" || skip_module "Dibatalkan oleh pengguna."
  case "$CHOICE" in 1) mode="tunnel" ;; 2) mode="ssl" ;; *) mode="http" ;; esac

  fqdn=""
  case "$mode" in
    tunnel)
      note "Hostname awam mesti sama dengan Public Hostname yang anda tetapkan pada tunnel di dashboard Cloudflare."
      fqdn="$(ask "Hostname awam Panel (cth panel.domain-anda.com)" "")"
      if ! valid_fqdn "$fqdn"; then die "Hostname tidak sah: '$fqdn'"; fi
      url="https://${fqdn}"
      if ! cloudflared_ask_token; then die "Token tunnel diperlukan untuk mod Cloudflare Tunnel."; fi ;;
    ssl)
      fqdn="$(ask "Domain Panel (cth panel.domain-anda.com)" "")"
      if ! valid_fqdn "$fqdn"; then die "Domain tidak sah: '$fqdn'"; fi
      url="https://${fqdn}" ;;
    *)
      url="http://$(host_ip)" ;;
  esac
  if port_in_use 80; then
    warn "Port 80 sedang digunakan oleh perkhidmatan lain; nginx mungkin gagal dimulakan."
    if ! ask_yn "Teruskan juga?" n; then skip_module "Dibatalkan oleh pengguna."; fi
  fi

  panel_ask_admin
  tz="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
  tz="$(ask "Zon waktu Panel" "${tz:-UTC}")"
  dbpass="$(rand_chars 'A-Za-z0-9' 24)"

  printf '\n'
  ui_box "PELAN PEMASANGAN PANEL" "$C_CYN" \
    "$(kv "Mod akses" "$mode")" \
    "$(kv "URL Panel" "$url")" \
    "$(kv "Admin" "${AD_USER} <${AD_EMAIL}>")" \
    "$(kv "Zon waktu" "$tz")" \
    "$(kv "Direktori" "$PANEL_DIR")"
  if ! ask_yn "Mulakan pemasangan?" y; then skip_module "Dibatalkan oleh pengguna."; fi

  # ---- Pemasangan ---------------------------------------------------------------------------
  step "1/8  Kebergantungan (PHP, MariaDB, Redis, nginx)"
  panel_install_deps

  step "2/8  Composer"
  panel_install_composer

  step "3/8  Pangkalan data"
  panel_setup_db "$dbpass"

  step "4/8  Fail Panel"
  sudo mkdir -p "$PANEL_DIR"
  run "Memuat turun Panel Pterodactyl (versi terkini)" \
      curl -fL --retry 3 -o "$RUN_DIR/panel.tar.gz" https://github.com/pterodactyl/panel/releases/latest/download/panel.tar.gz
  run "Mengekstrak Panel" sudo tar -xzf "$RUN_DIR/panel.tar.gz" -C "$PANEL_DIR"
  sudo chmod -R 755 "$PANEL_DIR/storage" "$PANEL_DIR/bootstrap/cache"
  if ! sudo test -f "$PANEL_DIR/.env"; then sudo cp "$PANEL_DIR/.env.example" "$PANEL_DIR/.env"; fi
  run "Memasang pakej PHP (composer install)" \
      sudo bash -c "cd '$PANEL_DIR' && COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --optimize-autoloader --no-interaction"

  step "5/8  Konfigurasi persekitaran dan pangkalan data"
  run "Menjana APP_KEY" panel_artisan key:generate --force
  run "Menetapkan persekitaran Panel" \
      panel_artisan p:environment:setup --author="$AD_EMAIL" --url="$url" --timezone="$tz" \
        --cache=redis --session=redis --queue=redis --redis-host=127.0.0.1 --redis-pass=null --redis-port=6379 \
        --settings-ui=true --telemetry=false
  panel_env_set DB_HOST 127.0.0.1
  panel_env_set DB_PORT 3306
  panel_env_set DB_DATABASE panel
  panel_env_set DB_USERNAME pterodactyl
  panel_env_set DB_PASSWORD "$dbpass"
  if [[ "$mode" == "tunnel" ]]; then panel_env_set TRUSTED_PROXIES '*'; fi
  run "Membina jadual dan data awal (migrate --seed, mungkin ambil masa)" panel_artisan migrate --seed --force
  panel_make_admin "$AD_EMAIL" "$AD_USER" "$AD_FIRST" "$AD_LAST" "$AD_PASS"

  step "6/8  Kebenaran, cron dan queue worker"
  sudo chown -R www-data:www-data "$PANEL_DIR"
  put_file /etc/cron.d/pterodactyl 644 <<'CRON'
* * * * * www-data /usr/bin/php /var/www/pterodactyl/artisan schedule:run >> /dev/null 2>&1
CRON
  put_file /etc/systemd/system/pteroq.service 644 <<'UNIT'
# Pterodactyl Queue Worker File
[Unit]
Description=Pterodactyl Queue Worker
After=redis-server.service

[Service]
User=www-data
Group=www-data
Restart=always
ExecStart=/usr/bin/php /var/www/pterodactyl/artisan queue:work --queue=high,standard,low --sleep=3 --tries=3
StartLimitInterval=180
StartLimitBurst=30
RestartSec=5s

[Install]
WantedBy=multi-user.target
UNIT
  run "Mengaktifkan pteroq (queue worker)" bash -c "sudo systemctl daemon-reload && sudo systemctl enable --now pteroq.service"

  step "7/8  Nginx"
  panel_write_nginx "$mode" "$fqdn"
  run "Menguji konfigurasi nginx" sudo nginx -t
  run "Mengaktifkan dan memuat semula nginx" bash -c "sudo systemctl enable nginx && sudo systemctl restart nginx"

  step "8/8  Akses"
  case "$mode" in
    tunnel)
      cloudflared_install
      if ! cloudflared_connect; then
        warn "Tunnel tidak aktif. Panel hanya boleh dicapai pada 127.0.0.1:80 sehingga tunnel disambungkan."
      fi ;;
    ssl)
      if dns_check_confirm "$fqdn"; then
        apt_install certbot python3-certbot-nginx
        fw_allow "80/tcp" "Panel HTTP"
        fw_allow "443/tcp" "Panel HTTPS"
        email_ssl="$AD_EMAIL"
        if try "Mendapatkan sijil Let's Encrypt untuk ${fqdn}" \
             sudo certbot --nginx -d "$fqdn" --non-interactive --agree-tos -m "$email_ssl" --redirect; then
          ok "SSL aktif untuk ${fqdn} (pembaharuan automatik oleh certbot)"
        else
          warn "Sijil gagal diperoleh. Semak DNS dan port 80; cuba: sudo certbot --nginx -d ${fqdn}"
        fi
      else
        warn "SSL dilangkau. Jalankan kemudian: sudo certbot --nginx -d ${fqdn}"
        fw_allow "80/tcp" "Panel HTTP"
      fi ;;
    *)
      fw_allow "80/tcp" "Panel HTTP" ;;
  esac
  if try "Menyemak Panel melalui HTTP tempatan" panel_health "${fqdn:-localhost}"; then
    status_line="${C_GRN}responsif${C_RST}"
  else
    status_line="${C_YEL}belum responsif (semak log nginx)${C_RST}"
  fi

  # ---- Kelayakan dan ringkasan --------------------------------------------------------------
  appkey="$(sudo grep -m1 '^APP_KEY=' "$PANEL_DIR/.env" 2>/dev/null || true)"
  cred="$STATE_DIR/credentials/pterodactyl-panel.txt"
  ( umask 077
    cat >"$cred" <<EOF
Pterodactyl Panel  -  $(date '+%F %T')
URL            : ${url}
Admin          : ${AD_USER} <${AD_EMAIL}>
Kata laluan    : ${AD_PASS}
Pangkalan data : panel / pterodactyl / ${dbpass}  (127.0.0.1:3306)
${appkey}

AMARAN: simpan APP_KEY di tempat selamat (pengurus kata laluan). Jika hilang,
data yang disulitkan (cth kunci API) tidak boleh dipulihkan walaupun ada sandaran DB.
EOF
  )
  fix_owner "$cred"

  printf '\n'
  ui_box "PANEL PTERODACTYL SEDIA" "$C_GRN" \
    "$(kv "URL" "$url")" \
    "$(kv "Admin" "$AD_USER")" \
    "$(kv "Kata laluan" "$AD_PASS")" \
    "$(kv "Respons" "$status_line")" \
    "$(kv "PHP" "${PANEL_PHP}-fpm")" \
    "---" \
    "Seterusnya: log masuk > Admin > Locations > Nodes > Create New," \
    "kemudian pasang Wings (modul $(mod_no wings)) dan tampal arahan 'wings configure'."
  note "Kelayakan dan APP_KEY disimpan (chmod 600): $cred"
  if [[ "$mode" == "tunnel" ]]; then
    cloudflared_hostname_help
    note "Pastikan Public Hostname '${fqdn}' menuju ke HTTP 127.0.0.1:80 pada tunnel anda."
  fi
  note "E-mel (SMTP) boleh ditetapkan dalam Panel: Admin > Settings > Mail."
  CF_TOKEN=""
}

#==============================================================================
#  UTAMA: registri modul, menu, pelaksana, ringkasan
#==============================================================================

MODULES=(python rdp docker nodejs tailscale firewall devtools monitoring vm wings panel cloudflared mesh)
# Susunan pelaksanaan sebenar (bergantung pada kebergantungan, bukan nombor menu)
RUN_ORDER=(devtools python nodejs docker tailscale mesh cloudflared rdp vm panel wings monitoring firewall)

declare -A MOD_TITLE=(
  [python]="Python Server"        [rdp]="RDP + Tailscale"       [docker]="Docker Engine"
  [nodejs]="Node.js LTS"          [tailscale]="Tailscale VPN"   [firewall]="Firewall (UFW)"
  [devtools]="Dev Tools"          [monitoring]="Monitoring"     [vm]="Mesin Maya (KVM)"
  [wings]="Pterodactyl Wings"     [panel]="Pterodactyl Panel"   [cloudflared]="Cloudflare Tunnel"
  [mesh]="Mesh VPN lain"
)
declare -A MOD_DESC=(
  [python]="FastAPI, Uvicorn, Gunicorn, venv"
  [rdp]="xRDP, XFCE4, akses melalui VPN"
  [docker]="Docker CE dan Compose"
  [nodejs]="Node, npm, pm2, yarn"
  [tailscale]="Rangkaian VPN mesh"
  [firewall]="Dasar selamat dan peraturan port"
  [devtools]="git, tmux, zsh, neovim, ripgrep"
  [monitoring]="Netdata, statistik masa nyata"
  [vm]="Windows, Ubuntu, Debian, Rocky"
  [wings]="Daemon node untuk Pterodactyl"
  [panel]="Panel web: nginx, PHP, MariaDB"
  [cloudflared]="Tunnel dengan token, tanpa port"
  [mesh]="ZeroTier dan NetBird"
)

mod_no() {  # nombor menu bagi sesuatu modul
  local i
  for i in "${!MODULES[@]}"; do
    if [[ "${MODULES[i]}" == "$1" ]]; then printf '%d' $(( i + 1 )); return 0; fi
  done
  printf '?'
}

mod_status() {  # status 0 = sudah dipasang
  case "$1" in
    python)      [[ -x "$VENV_DIR/bin/python" ]] ;;
    rdp)         systemctl is-active --quiet xrdp 2>/dev/null ;;
    docker)      command_exists docker ;;
    nodejs)      command_exists node ;;
    tailscale)   command_exists tailscale ;;
    firewall)    systemctl is-active --quiet ufw 2>/dev/null ;;
    devtools)    [[ -d "$REAL_HOME/.oh-my-zsh" ]] || command_exists nvim ;;
    monitoring)  command_exists netdata ;;
    vm)          systemctl is-active --quiet libvirtd 2>/dev/null \
                   || systemctl is-active --quiet libvirtd.socket 2>/dev/null \
                   || systemctl is-active --quiet virtqemud.socket 2>/dev/null ;;
    wings)       [[ -x /usr/local/bin/wings ]] ;;
    panel)       [[ -f /var/www/pterodactyl/artisan ]] ;;
    cloudflared) systemctl is-active --quiet cloudflared 2>/dev/null ;;
    mesh)        command_exists zerotier-cli || command_exists netbird ;;
    *)           return 1 ;;
  esac
}

kv2() {  # dua lajur label/nilai untuk ui_box
  printf '%s%-8s%s %-28s %s%-8s%s %s' "$C_GRY" "$1" "$C_RST" "$2" "$C_GRY" "$3" "$C_RST" "$4"
}

preflight_os() {
  local ids
  if [[ ! -r /etc/os-release ]]; then die "/etc/os-release tidak dijumpai."; fi
  ids="$(. /etc/os-release && printf '%s %s' "${ID:-}" "${ID_LIKE:-}")"
  if ! grep -qiE 'ubuntu|debian' <<<"$ids"; then die "Skrip ini hanya untuk Ubuntu/Debian (berasaskan apt)."; fi
  command_exists apt-get || die "apt-get tidak dijumpai."
}

show_banner() {
  local os cores mem disk virt
  os="$(. /etc/os-release && printf '%s' "${PRETTY_NAME:-Linux}")"
  cores="$(nproc 2>/dev/null || echo 1)"
  mem="$(awk '/MemTotal/ {printf "%.1f GiB", $2 / 1048576}' /proc/meminfo)"
  disk="$(df -h --output=avail / 2>/dev/null | tail -n1 | tr -d ' ')"
  virt="$(systemd-detect-virt 2>/dev/null || true)"
  if (( UI_TTY )); then clear; fi
  printf '\n'
  ui_box "SERVER PROVISIONER  v${APP_VERSION}" "$C_BLU" \
    "$(kv2 "Hos" "$(hostname -s)" "OS" "$os")" \
    "$(kv2 "CPU" "${cores} teras" "RAM" "$mem")" \
    "$(kv2 "Cakera" "${disk} bebas" "Virt" "${virt:-none}")" \
    "$(kv2 "Pengguna" "$REAL_USER" "Log" "${LOG_FILE/#$REAL_HOME/\~}")"
}

show_menu() {
  local i key st
  printf '\n  %s%3s  %-20s  %-34s  %s%s\n' "$C_GRY" "NO" "MODUL" "KETERANGAN" "STATUS" "$C_RST"
  rule 76
  for i in "${!MODULES[@]}"; do
    key="${MODULES[i]}"
    if mod_status "$key"; then st="${C_GRN}terpasang${C_RST}"; else st="${C_GRY}-${C_RST}"; fi
    printf '  %s%3d%s  %-20s  %-34s  %s\n' "${C_CYN}${C_BOLD}" $(( i + 1 )) "$C_RST" "${MOD_TITLE[$key]}" "${MOD_DESC[$key]}" "$st"
  done
  rule 76
  printf '  %s%3s%s  %s\n' "${C_CYN}${C_BOLD}" "A" "$C_RST" "Semua modul"
  printf '  %s%3s%s  %s\n' "${C_RED}${C_BOLD}" "0" "$C_RST" "Keluar"
  printf '\n  %sContoh: 3 10   |   1,3,11   |   1-4   |   A%s\n' "$C_GRY" "$C_RST"
}

declare -A SELECTED=()
# parse_selection "<teks>"  -> SELECTED ; status 0 = sah, 1 = tidak sah, 2 = keluar
parse_selection() {
  local raw="${1,,}" tok a b i n=${#MODULES[@]}
  local -a toks=()
  SELECTED=()
  raw="${raw//,/ }"
  read -ra toks <<<"$raw"
  if (( ${#toks[@]} == 0 )); then return 1; fi
  for tok in "${toks[@]}"; do
    case "$tok" in
      a|all|semua)
        for i in "${!MODULES[@]}"; do SELECTED["${MODULES[i]}"]=1; done ;;
      0|q|quit|exit|keluar)
        return 2 ;;
      [0-9]*-[0-9]*)
        a="${tok%-*}"; b="${tok#*-}"
        if ! [[ "$a" =~ ^[0-9]+$ && "$b" =~ ^[0-9]+$ ]]; then return 1; fi
        a=$(( 10#$a )); b=$(( 10#$b ))
        if (( a < 1 || b > n || a > b )); then return 1; fi
        for (( i = a; i <= b; i++ )); do SELECTED["${MODULES[i-1]}"]=1; done ;;
      *[!0-9]*)
        return 1 ;;
      *)
        tok=$(( 10#$tok ))
        if (( tok < 1 || tok > n )); then return 1; fi
        SELECTED["${MODULES[tok-1]}"]=1 ;;
    esac
  done
  return 0
}

PLAN=()
build_plan() {
  local k
  PLAN=()
  for k in "${RUN_ORDER[@]}"; do
    if [[ -n "${SELECTED[$k]:-}" ]]; then PLAN+=("$k"); fi
  done
}

bootstrap_prereqs() {
  step "Prasyarat sistem"
  apt_install curl ca-certificates gnupg lsb-release openssl iproute2 procps tar
  chmod 755 "$RUN_DIR"   # supaya pengguna lain (cth rdp, www-data) boleh membaca fail yang dimuat turun
}

declare -A RESULT=() ELAPSED=()
run_module() {  # run_module <kunci>
  local key="$1" t0 el
  t0="$(now_ms)"
  isolate "module_${key}"
  el=$(( $(now_ms) - t0 ))
  ELAPSED["$key"]="$(fmt_elapsed "$el")"
  case "$ISO_RC" in
    0)  RESULT["$key"]="ok" ;;
    10) RESULT["$key"]="skip" ;;
    *)  RESULT["$key"]="fail" ;;
  esac
}

show_summary() {
  local key word color fails=0
  local -a lines=()
  for key in "${PLAN[@]}"; do
    case "${RESULT[$key]:-}" in
      ok)   word="BERJAYA";   color="$C_GRN" ;;
      skip) word="DILANGKAU"; color="$C_YEL" ;;
      *)    word="GAGAL";     color="$C_RED"; fails=$(( fails + 1 )) ;;
    esac
    lines+=("$(printf '%2s  %-22s %s%-10s%s  %s' "$(mod_no "$key")" "${MOD_TITLE[$key]}" "$color" "$word" "$C_RST" "${ELAPSED[$key]:-}")")
  done
  printf '\n'
  if (( fails == 0 )); then
    ui_box "RINGKASAN" "$C_GRN" "${lines[@]}"
  else
    ui_box "RINGKASAN  (${fails} modul gagal)" "$C_RED" "${lines[@]}"
  fi

  printf '\n  %sLangkah seterusnya%s\n' "$C_BOLD" "$C_RST"
  for key in "${PLAN[@]}"; do
    if [[ "${RESULT[$key]:-}" != "ok" ]]; then continue; fi
    case "$key" in
      devtools|python) note "source ~/.bashrc          muat alias dan prompt baharu" ;;
      docker)          note "Log keluar dan masuk semula supaya kumpulan 'docker' berkuat kuasa" ;;
      tailscale)       note "sudo tailscale status      semak rangkaian Tailscale" ;;
      vm)              note "Jalankan semula modul $(mod_no vm) untuk mencipta atau mengurus VM" ;;
      wings)           note "journalctl -u wings -f     log langsung Wings" ;;
      panel)           note "Kelayakan Panel: $STATE_DIR/credentials/pterodactyl-panel.txt" ;;
      cloudflared)     note "journalctl -u cloudflared  status tunnel" ;;
    esac
  done
  printf '\n  %sLog penuh      : %s%s\n' "$C_GRY" "$LOG_FILE" "$C_RST"
  printf '  %sKelayakan (600): %s/credentials%s\n\n' "$C_GRY" "$STATE_DIR" "$C_RST"
  return "$fails"
}

main() {
  local sel rc=1 k i fails=0
  parse_args "$@"
  ui_init
  trap on_interrupt INT TERM
  trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR

  preflight_os
  init_runtime
  trap cleanup EXIT
  ensure_privileges

  if [[ -n "$CLI_MODULES" ]]; then
    parse_selection "$CLI_MODULES" || { rc=$?; if (( rc == 2 )); then exit 0; fi; die "Senarai modul tidak sah: '$CLI_MODULES'"; }
  else
    show_banner
    while true; do
      show_menu
      sel="$(ask "Pilihan" "")"
      rc=0
      parse_selection "$sel" || rc=$?
      if (( rc == 0 )); then break; fi
      if (( rc == 2 )); then printf '\n'; note "Keluar."; exit 0; fi
      warn "Pilihan tidak sah: '${sel}'. Gunakan nombor 1-${#MODULES[@]}, A atau 0."
    done
  fi

  build_plan
  if (( ${#PLAN[@]} == 0 )); then note "Tiada modul dipilih."; exit 0; fi

  printf '\n  %sPelan pelaksanaan%s\n' "$C_BOLD" "$C_RST"
  i=0
  for k in "${PLAN[@]}"; do
    i=$(( i + 1 ))
    printf '    %s%2d.%s  %-22s %s(modul %s)%s\n' "$C_CYN" "$i" "$C_RST" "${MOD_TITLE[$k]}" "$C_GRY" "$(mod_no "$k")" "$C_RST"
  done
  printf '\n'
  if ! ask_yn "Teruskan pemasangan?" y; then note "Dibatalkan."; exit 0; fi

  bootstrap_prereqs
  for k in "${PLAN[@]}"; do run_module "$k"; done
  show_summary || fails=$?
  exit $(( fails > 0 ? 1 : 0 ))
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
