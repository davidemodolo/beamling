#!/bin/sh
set -eu
if ! awslocal kms describe-key --key-id alias/beamling-local >/dev/null 2>&1; then
  KEY_ID=$(awslocal kms create-key --description "Beamling local workspace keys" --query KeyMetadata.KeyId --output text)
  awslocal kms create-alias --alias-name alias/beamling-local --target-key-id "$KEY_ID"
fi
