#!/usr/bin/env bash
# Billing kill switch for the whole billing account. Safe to re-run.
#
#   budget (all projects on the account) --Pub/Sub--> Eventarc --> workflow billing-guard
#
# Google Cloud budgets only alert; this turns the budget into a hard stop. When the month's cost
# reaches BUDGET, the workflow detaches billing from every project on the account (the host project
# last), which stops all paid services. Cost data lags by hours, so spend can pass BUDGET slightly.
# Re-enable billing by hand: Billing > Account management > link each project again.
#
# The billing-guard identity can only list the account's projects (billing.viewer on the account)
# and detach billing (billing.projectManager on each linked project). Re-run this script after
# linking a new project so the guard can stop it too.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-beamling-prod}"
REGION="${REGION:-europe-west1}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:?set BILLING_ACCOUNT to the billing account id}"
BUDGET="${BUDGET:-5EUR}"
BUDGET_NAME="Account hard limit"

g() { gcloud --project "$PROJECT_ID" --quiet "$@"; }
exists() { "$@" >/dev/null 2>&1; }
step() { printf '\n== %s\n' "$*"; }

PROJECT_NUMBER="$(g projects describe "$PROJECT_ID" --format='value(projectNumber)')"
GUARD_SA="billing-guard@$PROJECT_ID.iam.gserviceaccount.com"
TOPIC="projects/$PROJECT_ID/topics/billing-guard"
HERE="$(cd "$(dirname "$0")" && pwd)"

step "APIs"
g services enable pubsub.googleapis.com workflows.googleapis.com workflowexecutions.googleapis.com \
  eventarc.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com

step "Identity"
exists g iam service-accounts describe "$GUARD_SA" ||
  g iam service-accounts create billing-guard --display-name "Billing kill switch" \
    --description "Detaches billing from every project on the billing account when the budget is exceeded."
gcloud billing accounts add-iam-policy-binding "$BILLING_ACCOUNT" \
  --member "serviceAccount:$GUARD_SA" --role roles/billing.viewer >/dev/null
for project in $(gcloud billing projects list --billing-account "$BILLING_ACCOUNT" --format='value(projectId)'); do
  gcloud projects add-iam-policy-binding "$project" --member "serviceAccount:$GUARD_SA" \
    --role roles/billing.projectManager --condition None >/dev/null
  echo "can stop: $project"
done
g projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$GUARD_SA" \
  --role roles/workflows.invoker --condition None >/dev/null
g projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$GUARD_SA" \
  --role roles/logging.logWriter --condition None >/dev/null

step "Topic"
exists g pubsub topics describe billing-guard || g pubsub topics create billing-guard
g pubsub topics add-iam-policy-binding billing-guard \
  --member serviceAccount:billing-budget-alert@system.gserviceaccount.com \
  --role roles/pubsub.publisher >/dev/null

step "Workflow"
g workflows deploy billing-guard --location "$REGION" --source "$HERE/billing-guard.workflow.yaml" \
  --service-account "$GUARD_SA" --set-env-vars "BILLING_ACCOUNT=$BILLING_ACCOUNT" \
  --description "Billing kill switch (deploy/gcp/billing-guard.sh)" >/dev/null

step "Trigger"
exists g eventarc triggers describe billing-guard --location "$REGION" ||
  g eventarc triggers create billing-guard --location "$REGION" \
    --destination-workflow billing-guard --destination-workflow-location "$REGION" \
    --event-filters type=google.cloud.pubsub.topic.v1.messagePublished \
    --transport-topic "$TOPIC" --service-account "$GUARD_SA"

step "Budget on the whole billing account"
existing="$(gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" --billing-project "$PROJECT_ID" \
  --format='value(name,displayName)' | awk -F'\t' -v n="$BUDGET_NAME" '$2 == n {print $1}')"
if [[ -z "$existing" ]]; then
  gcloud billing budgets create --billing-account "$BILLING_ACCOUNT" --billing-project "$PROJECT_ID" \
    --display-name "$BUDGET_NAME" --budget-amount "$BUDGET" \
    --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0 \
    --threshold-rule percent=1.0,basis=forecasted-spend \
    --notifications-rule-pubsub-topic "$TOPIC" >/dev/null
fi
echo "Budget: $BUDGET across every project on $BILLING_ACCOUNT (project number $PROJECT_NUMBER hosts the guard)."
