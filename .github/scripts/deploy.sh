#!/usr/bin/env bash
# Called over pinned SSH by GitHub Actions. No app secrets travel through CI.
set -Eeuo pipefail
umask 077

root=/opt/agent-platform
release_id=${1:?Release ID required}
app_image=${2:?App digest required}
sandbox_image=${3:?Sandbox digest required}
[[ $release_id =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || { echo 'Invalid release ID'; exit 2; }
for image in "$app_image" "$sandbox_image"; do
  [[ $image =~ ^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid ECR image digest'; exit 2; }
done
release="$root/releases/$release_id"
auth_dir="$root/registry-auth/$release_id"
previous="$root"
if [[ -e "$root/current" && ! -L "$root/current" ]]; then echo 'Invalid release pointer'; exit 2; fi
if [[ -L "$root/current" ]]; then previous=$(readlink -f "$root/current"); fi
[[ $previous == "$root" || $previous == "$root"/releases/* ]] || { echo 'Invalid previous release'; exit 2; }
[[ -f "$previous/compose.yml" && -f "$previous/.env.prod" ]] || { echo 'Production configuration missing'; exit 2; }

exec 9>"$root/.deploy.lock"
flock -n 9 || { echo 'Another agent deployment is active'; exit 1; }

compose() { sudo -n docker compose --project-name agent-platform --env-file "$release/.env" -f "$release/compose.yml" "$@"; }
old_compose() { sudo -n docker compose --project-name agent-platform --env-file "$previous/.env" -f "$previous/compose.yml" "$@"; }
check() { compose run -T --rm --no-deps --pull never --volume "$release:/release:ro" api python /release/check_runtime.py "$@"; }
changed=0
before_ledger=''
rollback_compatible=0

cleanup() {
  sudo -n rm -f "$auth_dir/config.json"
  sudo -n rmdir "$auth_dir" 2>/dev/null || true
}
rollback() {
  local status=$?
  trap - ERR
  if (( changed )); then
    local after_ledger
    after_ledger=$(check ledger) || after_ledger=unavailable
    if [[ $rollback_compatible == 1 && -n $before_ledger && $after_ledger == "$before_ledger" ]]; then
      echo 'Deployment failed; restoring the previous agent release'
      # Shared Compose service names ensure only this application is affected.
      old_compose --profile analysis up -d --pull never api worker || true
    else
      echo 'Previous code is not schema-compatible: no destructive database rollback attempted; forward fix required'
      compose --profile analysis stop api worker || true
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap rollback ERR

printf 'Preparing agent release %s\n' "$release_id"
cp "$previous/.env.prod" "$release/.env.prod"
cp "$previous/.env.runtime" "$release/.env.runtime"
chmod 600 "$release/.env.prod" "$release/.env.runtime"
# Carry forward host settings; release image and config paths override only agent values.
cp "$previous/.env" "$release/.env"
cat >> "$release/.env" <<EOF
AGENT_APP_IMAGE=$app_image
AGENT_RUNTIME_ENV_FILE=$release/.env.runtime
AGENT_MIGRATION_ENV_FILE=$release/.env.prod
EOF
chmod 600 "$release/.env"

sudo -n docker --config "$auth_dir" pull "$app_image"
sudo -n docker --config "$auth_dir" pull "$sandbox_image"
sandbox_id=$(sudo -n docker image inspect --format '{{.Id}}' "$sandbox_image")
[[ $sandbox_id =~ ^sha256:[a-f0-9]{64}$ ]]
compose config --quiet
before_ledger=$(check ledger)
[[ $before_ledger =~ ^[a-f0-9]{64}$ ]]
if old_compose run -T --rm --no-deps --pull never --volume "$release:/release:ro" \
  api python /release/check_runtime.py ready; then rollback_compatible=1; fi

# Stop admission first; allow the old worker to complete accepted work.
changed=1
old_compose stop api
check idle --timeout 120
old_compose --profile analysis stop worker

compose --profile tools run -T --rm --no-deps --pull never migrate
compose --profile tools run -T --rm --no-deps --pull never \
  --user "$(id -u):$(id -g)" --volume "$release:/release" \
  migrate python /release/prepare_runtime.py /release/.env.prod /release/.env.runtime \
  --sandbox-image "$sandbox_image" --sandbox-image-id "$sandbox_id"
check ready
compose --profile analysis up -d --pull never api worker

healthy=0
for attempt in {1..30}; do
  if curl -fsS --max-time 5 http://127.0.0.1:8001/ready > /dev/null; then healthy=1; break; fi
  printf 'Waiting for agent readiness (%s/30)\n' "$attempt"
  sleep 2
done
(( healthy == 1 ))
sleep 5
worker=$(compose ps -q worker)
[[ -n $worker ]]
[[ $(sudo -n docker inspect --format '{{.State.Running}}:{{.RestartCount}}:{{.State.OOMKilled}}' "$worker") == true:0:false ]]
# Verify unrelated service availability, without restarting or configuring it.
curl -fsS --max-time 10 http://127.0.0.1:8000/health > /dev/null
curl -fsS --retry 3 --retry-delay 2 --max-time 10 https://api.agent.kayceejenz.dev/ready > /dev/null

# Publish the release pointer only after all health checks pass.
ln -sfn "$release" "$root/current.next"
python3 -c 'import os,sys; os.replace(sys.argv[1], sys.argv[2])' "$root/current.next" "$root/current"
changed=0
echo 'Agent API and worker deployed successfully'
# Never run docker system/image prune or touch the RAG project/Caddy here.
