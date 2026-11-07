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
ALERT_EMAIL="${ALERT_EMAIL:-}"                       # optional: email when the switch fires or fails

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

step "Native Cloud Run spend cap (pauses Cloud Run; nothing is deleted; resets monthly)"
# Google's spend caps cover only Cloud Run, Cloud Run functions, Gemini and Vertex AI. The cap is on
# gross list-price cost (before the free allowance), so it pauses Cloud Run long before real charges
# approach the account budget above. services/152E-C115-5142 is the Cloud Run billing service.
CAP_NAME="Cloud Run spend cap ($PROJECT_ID)"
if ! gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" --billing-project "$PROJECT_ID" \
  --format='value(displayName)' | grep -qxF "$CAP_NAME"; then
  curl -sSf -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "x-goog-user-project: $PROJECT_ID" -H "Content-Type: application/json" \
    "https://billingbudgets.googleapis.com/v1/billingAccounts/$BILLING_ACCOUNT/budgets" -d @- >/dev/null <<JSON
{
  "displayName": "$CAP_NAME",
  "budgetFilter": {"projects": ["projects/$PROJECT_ID"], "services": ["services/152E-C115-5142"],
                   "creditTypesTreatment": "EXCLUDE_ALL_CREDITS", "calendarPeriod": "MONTH"},
  "amount": {"specifiedAmount": {"units": "${CAP_UNITS:-5}"}},
  "thresholdRules": [{"thresholdPercent": 0.5}, {"thresholdPercent": 0.8}, {"thresholdPercent": 1.0}],
  "notificationsRule": {"enableProjectLevelRecipients": true},
  "spendCap": {"inputState": "CONFIGURED"}
}
JSON
fi

if [[ -n "${ALERT_EMAIL:-}" ]]; then
  step "Email when the kill switch fires or fails"
  channel="$(gcloud beta monitoring channels list --project "$PROJECT_ID" --format='value(name,labels.email_address)' |
    awk -F'\t' -v e="$ALERT_EMAIL" '$2 == e {print $1; exit}')"
  [[ -n "$channel" ]] || channel="$(gcloud beta monitoring channels create --project "$PROJECT_ID" --type email \
    --display-name "$ALERT_EMAIL" --channel-labels "email_address=$ALERT_EMAIL" --format='value(name)')"
  if ! gcloud alpha monitoring policies list --project "$PROJECT_ID" --format='value(displayName)' |
    grep -qxF "Billing kill switch fired or failed"; then
    policy="$(mktemp)"
    cat >"$policy" <<JSON
{
  "displayName": "Billing kill switch fired or failed",
  "documentation": {"mimeType": "text/markdown", "content": "The billing-guard workflow is disabling billing (ALERT) or could not stop a project (ERROR). Check Workflows > billing-guard > Executions. Re-link billing promptly so Google does not start deleting resources."},
  "combiner": "OR",
  "conditions": [{"displayName": "billing-guard ALERT or ERROR log",
    "conditionMatchedLog": {"filter": "resource.type=\"workflows.googleapis.com/Workflow\" AND resource.labels.workflow_id=\"billing-guard\" AND severity>=ERROR"}}],
  "alertStrategy": {"notificationRateLimit": {"period": "300s"}, "autoClose": "604800s"},
  "notificationChannels": ["$channel"],
  "severity": "CRITICAL"
}
JSON
    gcloud alpha monitoring policies create --project "$PROJECT_ID" --policy-from-file "$policy" >/dev/null
    rm -f "$policy"
  fi
fi
