import type { E2EESyncEnvelope } from '../types/toolbox';

const PBKDF2_ITERATIONS = 250000;

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function deriveAesGcmKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSyncPayload(
  payload: unknown,
  passphrase: string,
  deviceName = 'Poste DevOps Principal'
): Promise<E2EESyncEnvelope> {
  if (!passphrase || passphrase.trim().length < 4) {
    throw new Error('La phrase secrète E2EE doit contenir au moins 4 caractères.');
  }

  const cleartext = JSON.stringify(payload);
  const cleartextHashSha256 = await sha256Hex(cleartext);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesGcmKey(passphrase, salt);

  const encodedPlain = new TextEncoder().encode(cleartext);
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    key,
    encodedPlain
  );

  const savedDeviceId =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('aegis_device_id') || `dev-${Math.random().toString(36).slice(2, 10)}`
      : 'dev-node-test';
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('aegis_device_id', savedDeviceId);
  }

  return {
    version: '1.0',
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    deviceId: savedDeviceId,
    deviceName,
    syncedAt: new Date().toISOString(),
    saltBase64: bufferToBase64(salt),
    ivBase64: bufferToBase64(iv),
    ciphertextBase64: bufferToBase64(cipherBuffer),
    cleartextHashSha256,
  };
}

export async function decryptSyncEnvelope<T = unknown>(
  envelope: E2EESyncEnvelope,
  passphrase: string
): Promise<{ data: T; verifiedIntegrity: boolean }> {
  const salt = base64ToUint8Array(envelope.saltBase64);
  const iv = base64ToUint8Array(envelope.ivBase64);
  const ciphertext = base64ToUint8Array(envelope.ciphertextBase64);

  const key = await deriveAesGcmKey(passphrase, salt);

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
      },
      key,
      ciphertext as unknown as BufferSource
    );
  } catch {
    throw new Error('Clé secrète E2EE incorrecte ou enveloppe altérée (échec d’authentification GCM).');
  }

  const cleartext = new TextDecoder().decode(decryptedBuffer);
  const computedHash = await sha256Hex(cleartext);
  const verifiedIntegrity = computedHash === envelope.cleartextHashSha256;

  return {
    data: JSON.parse(cleartext) as T,
    verifiedIntegrity,
  };
}
