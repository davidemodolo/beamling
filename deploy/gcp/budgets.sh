#!/usr/bin/env bash
# Spend controls for Beamling. Safe to re-run. Requires Billing Account Administrator.
#
#   1. Native Cloud Run spend cap: Google pauses new Cloud Run requests in the project when the
#      month's gross list-price Cloud Run cost (before the free allowance) reaches CAP_UNITS.
#      Nothing is deleted; the cap lifts on the 1st of the month or by hand from the budget page.
#      Cloud Run is where all traffic-driven cost (and its KMS, secret and log use) originates.
#   2. Account-wide email alert at 50%, 90% and 100% of ALERT_BUDGET (and on forecast), for
#      anything unexpected elsewhere on the billing account. It only alerts.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-beamling-prod}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:?set BILLING_ACCOUNT to the billing account id}"
CAP_UNITS="${CAP_UNITS:-5}"            # in the billing account currency
ALERT_BUDGET="${ALERT_BUDGET:-5EUR}"
CLOUD_RUN_SERVICE="services/152E-C115-5142"   # Cloud Run in the Cloud Billing catalog

budget_exists() {
  gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" --billing-project "$PROJECT_ID" \
    --format='value(displayName)' | grep -qxF "$1"
}

gcloud services enable billingbudgets.googleapis.com --project "$PROJECT_ID"

CAP_NAME="Cloud Run spend cap ($PROJECT_ID)"
if ! budget_exists "$CAP_NAME"; then
  # Spend caps are not exposed by gcloud yet; the Budget API requires exactly these filter and
  # threshold settings for a cap.
  curl -sSf -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "x-goog-user-project: $PROJECT_ID" -H "Content-Type: application/json" \
    "https://billingbudgets.googleapis.com/v1/billingAccounts/$BILLING_ACCOUNT/budgets" -d @- >/dev/null <<JSON
{
  "displayName": "$CAP_NAME",
  "budgetFilter": {"projects": ["projects/$PROJECT_ID"], "services": ["$CLOUD_RUN_SERVICE"],
                   "creditTypesTreatment": "EXCLUDE_ALL_CREDITS", "calendarPeriod": "MONTH"},
  "amount": {"specifiedAmount": {"units": "$CAP_UNITS"}},
  "thresholdRules": [{"thresholdPercent": 0.5}, {"thresholdPercent": 0.8}, {"thresholdPercent": 1.0}],
  "notificationsRule": {"enableProjectLevelRecipients": true},
  "spendCap": {"inputState": "CONFIGURED"}
}
JSON
  echo "Created: $CAP_NAME"
fi

ALERT_NAME="Account monthly alert"
if ! budget_exists "$ALERT_NAME"; then
  gcloud billing budgets create --billing-account "$BILLING_ACCOUNT" --billing-project "$PROJECT_ID" \
    --display-name "$ALERT_NAME" --budget-amount "$ALERT_BUDGET" \
    --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0 \
    --threshold-rule percent=1.0,basis=forecasted-spend >/dev/null
  echo "Created: $ALERT_NAME"
fi
