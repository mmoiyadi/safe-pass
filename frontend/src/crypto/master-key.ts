/**
 * StretchedMasterKey derivation.
 *
 * HKDF-SHA256-Expand(MasterKey, info="pm:v1:stretch") -> 32 bytes.
 *
 * There is deliberately NO separate macKey. An earlier draft expanded to 64 bytes as
 * `encKey ‖ macKey`, inherited from AES-CBC + HMAC constructions where a distinct MAC key is
 * required. Every payload here is AES-256-GCM, which authenticates as part of the AEAD, so the
 * second key would have no consumer — and unused key material invites a later contributor to
 * find a use for it, most likely one that breaks key separation.
 */

const HKDF_INFO = new TextEncoder().encode('pm:v1:stretch');

/** RFC 5869 Expand, exposed so the published vectors can be asserted directly. */
export async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    prk,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const out = new Uint8Array(length);
  let previous = new Uint8Array(0);
  let offset = 0;

  for (let counter = 1; offset < length; counter++) {
    const input = new Uint8Array(previous.length + info.length + 1);
    input.set(previous, 0);
    input.set(info, previous.length);
    input[previous.length + info.length] = counter;

    previous = new Uint8Array(await crypto.subtle.sign('HMAC', key, input));
    const take = Math.min(previous.length, length - offset);
    out.set(previous.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

export async function deriveStretchedMasterKey(masterKey: Uint8Array): Promise<Uint8Array> {
  return hkdfExpand(masterKey, HKDF_INFO, 32);
}
