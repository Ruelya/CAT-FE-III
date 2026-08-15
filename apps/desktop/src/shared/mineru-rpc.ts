/**
 * MinerU credential RPCs exist on the Engine but are omitted from the
 * generated catalog so the secret never appears in exported schemas.
 * Main and renderer must allow these names explicitly.
 */
export const MINERU_CREDENTIAL_SET = "mineru.credential.set";
export const MINERU_CREDENTIAL_STATUS = "mineru.credential.status";
export const MINERU_CREDENTIAL_DELETE = "mineru.credential.delete";

export const MINERU_CREDENTIAL_METHODS = [
  MINERU_CREDENTIAL_SET,
  MINERU_CREDENTIAL_STATUS,
  MINERU_CREDENTIAL_DELETE,
] as const;

export type MinerUCredentialMethod = (typeof MINERU_CREDENTIAL_METHODS)[number];

export function isMinerUCredentialMethod(
  method: string,
): method is MinerUCredentialMethod {
  return (MINERU_CREDENTIAL_METHODS as readonly string[]).includes(method);
}
