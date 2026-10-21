#!/bin/sh
set -eu
DIR=/certs
if [ -f "$DIR/ca.crt" ] && [ -f "$DIR/db.crt" ] && [ -f "$DIR/db.key" ]; then
  exit 0
fi
mkdir -p "$DIR"
openssl req -x509 -newkey rsa:4096 -nodes -keyout "$DIR/ca.key" -out "$DIR/ca.crt" -days 3650 -subj "/CN=Beamling Local CA"
openssl req -newkey rsa:2048 -nodes -keyout "$DIR/db.key" -out "$DIR/db.csr" -subj "/CN=db"
printf "subjectAltName=DNS:db,DNS:localhost,IP:127.0.0.1\n" > "$DIR/db.ext"
openssl x509 -req -in "$DIR/db.csr" -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" -CAcreateserial -out "$DIR/db.crt" -days 3650 -extfile "$DIR/db.ext"
rm -f "$DIR/db.csr" "$DIR/db.ext"
chown 70:70 "$DIR/db.crt" "$DIR/db.key"
chmod 600 "$DIR/db.key"
chmod 644 "$DIR/db.crt" "$DIR/ca.crt"
