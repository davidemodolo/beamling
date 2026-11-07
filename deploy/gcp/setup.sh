#!/usr/bin/env bash
# One-time Google Cloud setup for Beamling production. Safe to re-run: every step checks whether
# its resource already exists. Requires an authenticated gcloud with Owner on the project.
#
# What it creates, with the only permissions each identity gets:
#   - Cloud KMS key ring + key (90-day rotation, 120-day destroy delay), audit-logged.
#   - An EU log bucket (30-day retention) in place of the global default.
#   - Secret Manager secrets (values are added separately; this script never sees them).
#   - Artifact Registry remote repository that proxies the public GHCR release images.
#   - beamling-app      (Cloud Run service): encrypt/decrypt on the one key + read its secrets.
#   - beamling-migrate  (Cloud Run job):     read DATABASE_URL_DIRECT only.
#   - beamling-deploy   (GitHub Actions):    deploy Cloud Run + act as the two runtime accounts,
#                                            reachable only from the production environment of
#                                            this repository on main, via keyless OIDC.
# No service-account keys are created. Budgets (Cloud Run spend cap, account email alert) are set
# up separately by budgets.sh.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-beamling-prod}"
REGION="${REGION:-europe-west1}"           # Cloud Run, Artifact Registry, secrets
KMS_LOCATION="${KMS_LOCATION:-europe-west3}"
GITHUB_REPO="${GITHUB_REPO:-davidemodolo/beamling}"
GITHUB_REPO_ID="${GITHUB_REPO_ID:-1427513799}"       # immutable; survives a rename
GITHUB_OWNER_ID="${GITHUB_OWNER_ID:-36373601}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"                # optional: links billing (budgets: budgets.sh)

SECRETS=(DATABASE_URL DATABASE_URL_DIRECT AUTH_SECRET OIDC_CLIENT_SECRET KILL_SWITCH_SECRET METRICS_SECRET)

g() { gcloud --project "$PROJECT_ID" --quiet "$@"; }
exists() { "$@" >/dev/null 2>&1; }
step() { printf '\n== %s\n' "$*"; }

PROJECT_NUMBER="$(g projects describe "$PROJECT_ID" --format='value(projectNumber)')"
APP_SA="beamling-app@$PROJECT_ID.iam.gserviceaccount.com"
MIGRATE_SA="beamling-migrate@$PROJECT_ID.iam.gserviceaccount.com"
DEPLOY_SA="beamling-deploy@$PROJECT_ID.iam.gserviceaccount.com"
KEY="projects/$PROJECT_ID/locations/$KMS_LOCATION/keyRings/beamling/cryptoKeys/workspace"

if [[ -n "$BILLING_ACCOUNT" ]]; then
  step "Billing"
  g billing projects link "$PROJECT_ID" --billing-account "$BILLING_ACCOUNT" >/dev/null
fi

step "APIs (only what production uses)"
g services enable cloudkms.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com

step "KMS key ring and key"
exists g kms keyrings describe beamling --location "$KMS_LOCATION" ||
  g kms keyrings create beamling --location "$KMS_LOCATION"
exists g kms keys describe workspace --keyring beamling --location "$KMS_LOCATION" ||
  g kms keys create workspace --keyring beamling --location "$KMS_LOCATION" \
    --purpose encryption --protection-level software \
    --rotation-period 90d --next-rotation-time "$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)" \
    --destroy-scheduled-duration 120d

step "Audit every use of the key"
policy="$(mktemp)"
trap 'rm -f "$policy"' EXIT
g projects get-iam-policy "$PROJECT_ID" --format=json |
  jq '.auditConfigs = ((.auditConfigs // []) | map(select(.service != "cloudkms.googleapis.com"))) + [{"service":"cloudkms.googleapis.com","auditLogConfigs":[{"logType":"ADMIN_READ"},{"logType":"DATA_READ"},{"logType":"DATA_WRITE"}]}]' >"$policy"
g projects set-iam-policy "$PROJECT_ID" "$policy" >/dev/null

step "Logs stay in the EU for 30 days"
# The _Default bucket is global; route everything it would receive to an EU bucket instead.
exists g logging buckets describe beamling-eu --location "$REGION" ||
  g logging buckets create beamling-eu --location "$REGION" --retention-days 30 \
    --description "Beamling logs, kept in the EU for 30 days"
g logging sinks update _Default \
  "logging.googleapis.com/projects/$PROJECT_ID/locations/$REGION/buckets/beamling-eu" >/dev/null

step "Service accounts"
create_sa() {
  exists g iam service-accounts describe "$1@$PROJECT_ID.iam.gserviceaccount.com" ||
    g iam service-accounts create "$1" --display-name "$2" --description "$3"
}
create_sa beamling-app "Beamling app (Cloud Run service)" \
  "Runtime identity. Encrypt/decrypt on the workspace key and read the app secrets; nothing else."
create_sa beamling-migrate "Beamling migrations (Cloud Run job)" \
  "Runs database migrations. Reads DATABASE_URL_DIRECT only."
create_sa beamling-deploy "Beamling deploy (GitHub Actions)" \
  "Deploys Cloud Run from the production environment of $GITHUB_REPO via keyless OIDC."

step "Key access: app only"
g kms keys add-iam-policy-binding workspace --keyring beamling --location "$KMS_LOCATION" \
  --member "serviceAccount:$APP_SA" --role roles/cloudkms.cryptoKeyEncrypterDecrypter >/dev/null

step "Secrets (values are added separately)"
for name in "${SECRETS[@]}"; do
  exists g secrets describe "$name" ||
    g secrets create "$name" --replication-policy user-managed --locations "$REGION"
  g secrets add-iam-policy-binding "$name" --member "serviceAccount:$APP_SA" \
    --role roles/secretmanager.secretAccessor >/dev/null
done
g secrets add-iam-policy-binding DATABASE_URL_DIRECT --member "serviceAccount:$MIGRATE_SA" \
  --role roles/secretmanager.secretAccessor >/dev/null

step "Artifact Registry: proxy of the public GHCR images"
if ! exists g artifacts repositories describe ghcr --location "$REGION"; then
  g artifacts repositories create ghcr --location "$REGION" --repository-format docker \
    --mode remote-repository --remote-docker-repo https://ghcr.io \
    --remote-repo-config-desc "Public GHCR release images" \
    --description "Pull-through cache of ghcr.io release images for Cloud Run"
fi
cleanup="$(mktemp)"
cat >"$cleanup" <<'JSON'
[
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 5}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"olderThan": "30d"}}
]
JSON
g artifacts repositories set-cleanup-policies ghcr --location "$REGION" --policy "$cleanup" --no-dry-run >/dev/null
rm -f "$cleanup"

step "Deploy identity"
g projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY_SA" \
  --role roles/run.developer --condition None >/dev/null
for sa in "$APP_SA" "$MIGRATE_SA"; do
  g iam service-accounts add-iam-policy-binding "$sa" --member "serviceAccount:$DEPLOY_SA" \
    --role roles/iam.serviceAccountUser >/dev/null
done
# Cloud Run checks that the deployer can read the image it deploys; reader on the proxy only.
g artifacts repositories add-iam-policy-binding ghcr --location "$REGION" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/artifactregistry.reader >/dev/null

step "Keyless GitHub OIDC (production environment on main only)"
exists g iam workload-identity-pools describe github --location global ||
  g iam workload-identity-pools create github --location global --display-name "GitHub Actions"
CONDITION="assertion.repository_id == '$GITHUB_REPO_ID' && assertion.repository_owner_id == '$GITHUB_OWNER_ID' && assertion.ref == 'refs/heads/main' && assertion.environment == 'production'"
MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment"
if exists g iam workload-identity-pools providers describe github-actions --location global --workload-identity-pool github; then
  g iam workload-identity-pools providers update-oidc github-actions --location global \
    --workload-identity-pool github --attribute-mapping "$MAPPING" --attribute-condition "$CONDITION" >/dev/null
else
  g iam workload-identity-pools providers create-oidc github-actions --location global \
    --workload-identity-pool github --display-name "GitHub $GITHUB_REPO" \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping "$MAPPING" --attribute-condition "$CONDITION"
fi
# Bind by repository ID, not by subject: GitHub's subject format changes with its settings
# (the immutable form is repo:owner@id/name@id:...). The provider condition above already
# limits tokens to this repository and owner, the main branch and the production environment.
WIF_POOL="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github"
g iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/$WIF_POOL/attribute.repository_id/$GITHUB_REPO_ID" >/dev/null

step "Cloud Run service placeholder, public invoker"
# The first real deploy replaces the placeholder image; deploys never change IAM.
exists g run services describe beamling --region "$REGION" ||
  g run deploy beamling --region "$REGION" --image us-docker.pkg.dev/cloudrun/container/hello \
    --service-account "$APP_SA" --max-instances 1 --no-allow-unauthenticated >/dev/null
g run services add-iam-policy-binding beamling --region "$REGION" \
  --member allUsers --role roles/run.invoker >/dev/null

cat <<EOF

Done. GitHub environment "production" variables:
  GCP_WORKLOAD_IDENTITY_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-actions
  GCP_DEPLOY_SERVICE_ACCOUNT=$DEPLOY_SA
  KMS_KEY_NAME=$KEY
Add secret values with: gcloud secrets versions add NAME --data-file=- --project $PROJECT_ID
Then run: BILLING_ACCOUNT=<id> deploy/gcp/budgets.sh
EOF
