/**
 * MinerU credential RPCs are real Engine methods, but they are omitted from
 * the generated catalog so the secret never appears in exported schemas.
 * This wrapper is the only desktop call path — same wire names, typed by hand.
 */

export {
  MINERU_CREDENTIAL_DELETE,
  MINERU_CREDENTIAL_SET,
  MINERU_CREDENTIAL_STATUS,
} from "../../shared/mineru-rpc";
import {
  MINERU_CREDENTIAL_DELETE,
  MINERU_CREDENTIAL_SET,
  MINERU_CREDENTIAL_STATUS,
} from "../../shared/mineru-rpc";

export interface MinerUCredentialStatus {
  available: boolean;
  present: boolean;
  backend: string;
}

type MineruInvoke = (
  method: string,
  params: Record<string, unknown>,
) => Promise<MinerUCredentialStatus>;

function mineruInvoke(): MineruInvoke {
  return window.translunar.invoke as unknown as MineruInvoke;
}

export async function mineruCredentialStatus(): Promise<MinerUCredentialStatus> {
  return mineruInvoke()(MINERU_CREDENTIAL_STATUS, {});
}

export async function mineruCredentialSet(
  secret: string,
): Promise<MinerUCredentialStatus> {
  return mineruInvoke()(MINERU_CREDENTIAL_SET, { secret });
}

export async function mineruCredentialDelete(): Promise<MinerUCredentialStatus> {
  return mineruInvoke()(MINERU_CREDENTIAL_DELETE, {});
}
