export interface MasterKeys {
  current: { id: string; key: Buffer };
  byId: Map<string, Buffer>;
}

export interface WrappedKeyRow {
  id: string;
  user_id: string;
  kind: string;
  provider: string;
  key_id: string;
  wrapped_dek: string;
  dek_nonce: string;
  dek_tag: string;
}

export function credentialAad(userId: string, credentialId: string, kind: string, provider: string): Buffer;
export function loadKeys(env?: Record<string, string | undefined>): MasterKeys;
export function rewrapRow(
  row: WrappedKeyRow,
  keys: MasterKeys,
): Pick<WrappedKeyRow, "key_id" | "wrapped_dek" | "dek_nonce" | "dek_tag">;

export interface WorkspaceKeyRow {
  user_id: string;
  key_id: string;
  wrapped_key: string;
  wrap_nonce: string;
  wrap_tag: string;
}

export function workspaceWrapAad(userId: string): Buffer;
export function rewrapWorkspaceRow(
  row: WorkspaceKeyRow,
  keys: MasterKeys,
): Pick<WorkspaceKeyRow, "key_id" | "wrapped_key" | "wrap_nonce" | "wrap_tag">;
