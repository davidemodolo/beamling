import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { currentMasterKey, gcpCredentials, kmsProvider, masterKeyById } from "./env";

export interface WrappedKey {
  keyId: string;
  wrappedKey: string;
  nonce?: string;
  tag?: string;
}

function plaintextAad(aad: string): Buffer {
  return Buffer.from(aad, "utf8");
}

function sealEnv(key: Buffer, plaintext: Buffer, aad: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

function openEnv(key: Buffer, wrapped: string, nonce: string, tag: string, aad: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(wrapped, "base64")), decipher.final()]);
}

// AWS stores the key ARN even when KMS_KEY_ID is an alias; the resolved ARN is what rows are
// compared against, so they are not re-wrapped on every read.
let resolvedAwsKeyId: Promise<string> | undefined;

let awsClient: import("@aws-sdk/client-kms").KMSClient | undefined;
async function aws() {
  const { KMSClient } = await import("@aws-sdk/client-kms");
  awsClient ??= new KMSClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint: process.env.KMS_ENDPOINT || undefined,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  return awsClient;
}

let gcpClient: import("@google-cloud/kms").KeyManagementServiceClient | undefined;
async function gcp() {
  const { KeyManagementServiceClient } = await import("@google-cloud/kms");
  const credentials = gcpCredentials();
  gcpClient ??= new KeyManagementServiceClient(credentials ? { credentials } : {});
  return gcpClient;
}

export async function wrapKey(plaintext: Buffer, aad: string): Promise<WrappedKey> {
  switch (kmsProvider()) {
    case "env": {
      const master = currentMasterKey();
      const sealed = sealEnv(master.key, plaintext, plaintextAad(aad));
      return {
        keyId: master.id,
        wrappedKey: sealed.ciphertext.toString("base64"),
        nonce: sealed.nonce.toString("base64"),
        tag: sealed.tag.toString("base64"),
      };
    }
    case "aws": {
      const { EncryptCommand } = await import("@aws-sdk/client-kms");
      const keyId = process.env.KMS_KEY_ID;
      if (!keyId) throw new Error("KMS_KEY_ID is required for the AWS KMS adapter.");
      const result = await (await aws()).send(
        new EncryptCommand({
          KeyId: keyId,
          Plaintext: plaintext,
          EncryptionContext: { beamling: aad },
        }),
      );
      return { keyId: result.KeyId ?? keyId, wrappedKey: Buffer.from(result.CiphertextBlob ?? []).toString("base64") };
    }
    case "gcp": {
      const name = process.env.KMS_KEY_NAME;
      if (!name) throw new Error("KMS_KEY_NAME is required for the GCP KMS adapter.");
      const [result] = await (await gcp()).encrypt({
        name,
        plaintext,
        additionalAuthenticatedData: Buffer.from(aad, "utf8"),
      });
      return { keyId: name, wrappedKey: Buffer.from(result.ciphertext ?? []).toString("base64") };
    }
  }
}

export async function unwrapKey(wrapped: WrappedKey, aad: string): Promise<Buffer> {
  switch (kmsProvider()) {
    case "env": {
      if (!wrapped.nonce || !wrapped.tag) throw new Error("The environment-wrapped key is incomplete.");
      return openEnv(masterKeyById(wrapped.keyId), wrapped.wrappedKey, wrapped.nonce, wrapped.tag, plaintextAad(aad));
    }
    case "aws": {
      const { DecryptCommand } = await import("@aws-sdk/client-kms");
      const result = await (await aws()).send(
        new DecryptCommand({
          CiphertextBlob: Buffer.from(wrapped.wrappedKey, "base64"),
          EncryptionContext: { beamling: aad },
          // Prefer the resource that actually wrapped this row; a new KMS_KEY_ID is for new writes.
          KeyId: wrapped.keyId || process.env.KMS_KEY_ID || undefined,
        }),
      );
      return Buffer.from(result.Plaintext ?? []);
    }
    case "gcp": {
      // The stored resource name is authoritative; KMS_KEY_NAME is only the target for new writes.
      const name = wrapped.keyId || process.env.KMS_KEY_NAME;
      if (!name) throw new Error("KMS_KEY_NAME is required for the GCP KMS adapter.");
      const [result] = await (await gcp()).decrypt({
        name,
        ciphertext: Buffer.from(wrapped.wrappedKey, "base64"),
        additionalAuthenticatedData: Buffer.from(aad, "utf8"),
      });
      return Buffer.from(result.plaintext ?? []);
    }
  }
}

/** A cheap wrap/unwrap round trip that proves the configured KMS key is usable. */
export async function probeKms(): Promise<void> {
  const value = randomBytes(16);
  const aad = "beamling:readiness:v1";
  const wrapped = await wrapKey(value, aad);
  const opened = await unwrapKey(wrapped, aad);
  if (opened.length !== value.length || !timingSafeEqual(opened, value)) {
    throw new Error("KMS readiness probe returned different plaintext.");
  }
}

/**
 * The id new wraps are stored under: the env key id, the GCP key name, or the AWS key ARN (an
 * alias in KMS_KEY_ID is resolved once with DescribeKey). Rows with a different id are re-wrapped.
 */
export async function currentKmsKeyId(): Promise<string> {
  switch (kmsProvider()) {
    case "env":
      return currentMasterKey().id;
    case "gcp":
      return process.env.KMS_KEY_NAME ?? "";
    case "aws": {
      const keyId = process.env.KMS_KEY_ID ?? "";
      resolvedAwsKeyId ??= (async () => {
        const { DescribeKeyCommand } = await import("@aws-sdk/client-kms");
        const result = await (await aws()).send(new DescribeKeyCommand({ KeyId: keyId }));
        return result.KeyMetadata?.Arn ?? keyId;
      })().catch((error) => {
        resolvedAwsKeyId = undefined;
        throw error;
      });
      return resolvedAwsKeyId;
    }
  }
}
