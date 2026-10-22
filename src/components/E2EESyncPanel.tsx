import React, { useState } from 'react';
import {
  Lock,
  RefreshCw,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { E2EESyncEnvelope } from '../types/toolbox';
import { encryptSyncPayload, decryptSyncEnvelope } from '../services/e2eeCrypto';
import { saveLocalE2EEEnvelope, loadLocalE2EEEnvelope } from '../services/offlineStore';

interface E2EESyncPanelProps {
  syncableState: unknown;
  onRestoreState: (restored: Record<string, unknown>) => void;
  onNotify: (title: string, message: string, severity?: 'info' | 'low' | 'medium' | 'high' | 'critical') => void;
}

export const E2EESyncPanel: React.FC<E2EESyncPanelProps> = ({
  syncableState,
  onRestoreState,
  onNotify,
}) => {
  const [passphrase, setPassphrase] = useState('Aegis-Master-ZeroKnowledge-2026!');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [deviceName, setDeviceName] = useState('Workstation-01');
  const [envelope, setEnvelope] = useState<E2EESyncEnvelope | null>(() => loadLocalE2EEEnvelope());
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCipherInspector, setShowCipherInspector] = useState(false);

  const handleEncryptAndSync = async () => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMessage(null);
    try {
      const encrypted = await encryptSyncPayload(syncableState, passphrase, deviceName);
      setEnvelope(encrypted);
      saveLocalE2EEEnvelope(encrypted);

      try {
        await fetch('/api/sync/vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ envelope: encrypted }),
        });
      } catch {
        // Offline cache fallback
      }

      setStatusMessage(
        `Encrypted with AES-256-GCM (PBKDF2 250k iterations). SHA-256: ${encrypted.cleartextHashSha256.slice(0, 16)}...`
      );
      onNotify(
        'E2EE Sync Completed',
        `State encrypted (${encrypted.algorithm}) for ${deviceName}.`,
        'info'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Encryption error');
    } finally {
      setBusy(false);
    }
  };

  const handlePullAndDecrypt = async () => {
    setBusy(true);
    setErrorMsg(null);
    setStatusMessage(null);
    try {
      let targetEnvelope = envelope;
      try {
        const res = await fetch('/api/sync/vault');
        if (res.ok) {
          const data = await res.json();
          if (data.envelope) targetEnvelope = data.envelope;
        }
      } catch {
        // Use local cached envelope
      }

      if (!targetEnvelope) {
        throw new Error('No encrypted envelope found. Encrypt and push state first.');
      }

      const decrypted = await decryptSyncEnvelope<Record<string, unknown>>(targetEnvelope, passphrase);
      setEnvelope(targetEnvelope);
      onRestoreState(decrypted.data);
      setStatusMessage(
        `Decryption verified. SHA-256 Integrity: ${decrypted.verifiedIntegrity ? 'VALID' : 'MISMATCH'}`
      );
      onNotify(
        'E2EE Vault Restored',
        `Synchronized from "${targetEnvelope.deviceName}" with GCM verification.`,
        'info'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Decryption failed');
    } finally {
      setBusy(false);
    }
  };

  const handleExportBundle = () => {
    if (!envelope) return;
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegis-sync-${envelope.deviceId}.e2ee.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBundle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = JSON.parse(String(reader.result)) as E2EESyncEnvelope;
        setEnvelope(imported);
        saveLocalE2EEEnvelope(imported);
        const decrypted = await decryptSyncEnvelope<Record<string, unknown>>(imported, passphrase);
        onRestoreState(decrypted.data);
        setStatusMessage(`E2EE bundle imported from ${imported.deviceName}.`);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Invalid E2EE file or wrong passphrase');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between border-b border-[#22242c] pb-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">End-to-End Encrypted Sync (AES-256-GCM)</h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Zero-knowledge client-side encryption via Web Crypto API (PBKDF2-SHA256, 250,000 iterations).
          </p>
        </div>
        <span className="px-2 py-0.5 rounded bg-[#181a20] border border-[#272a34] font-mono text-[10px] text-zinc-300">
          AES-256-GCM
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">Master Passphrase (PBKDF2)</label>
          <div className="relative">
            <input
              type={showPassphrase ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 pr-8 text-xs text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
            />
            <button
              type="button"
              onClick={() => setShowPassphrase((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
            >
              {showPassphrase ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-zinc-400 mb-1">Device Identifier</label>
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="w-full rounded-md bg-[#0b0c0e] border border-[#24262e] px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleEncryptAndSync}
          className="px-3.5 py-1.5 rounded-md bg-zinc-100 hover:bg-white text-zinc-950 font-medium flex items-center gap-1.5 transition disabled:opacity-50"
        >
          <Lock className="w-3.5 h-3.5" />
          {busy ? 'Encrypting...' : 'Encrypt & Push Vault'}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={handlePullAndDecrypt}
          className="px-3.5 py-1.5 rounded-md bg-[#16171d] hover:bg-[#1e2028] text-zinc-200 border border-[#262932] font-medium flex items-center gap-1.5 transition disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Pull & Decrypt
        </button>

        {envelope && (
          <>
            <button
              type="button"
              onClick={handleExportBundle}
              className="px-3 py-1.5 rounded-md bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-zinc-300 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Export .e2ee
            </button>
            <label className="px-3 py-1.5 rounded-md bg-[#16171d] hover:bg-[#1e2028] border border-[#262932] text-zinc-300 flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              Import
              <input type="file" accept=".json" onChange={handleImportBundle} className="hidden" />
            </label>
          </>
        )}
      </div>

      {envelope && (
        <div className="p-3.5 rounded-md bg-[#0b0c0e] border border-[#22242c] space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-emerald-400 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Encrypted Envelope Active ({envelope.deviceName})
            </span>
            <span className="text-zinc-500 font-mono">
              {new Date(envelope.syncedAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="font-mono text-[11px] text-zinc-400 truncate">
            SHA-256: <span className="text-zinc-200">{envelope.cleartextHashSha256}</span>
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowCipherInspector((v) => !v)}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
            >
              {showCipherInspector ? 'Hide raw ciphertext' : 'Inspect raw ciphertext (Zero-Knowledge proof)'}
            </button>
          </div>

          {showCipherInspector && (
            <pre className="p-2.5 rounded bg-[#07080a] border border-[#1d1f26] text-[10px] font-mono text-zinc-300 overflow-x-auto max-h-28">
{`IV (96-bit)   : ${envelope.ivBase64}
Salt (128-bit): ${envelope.saltBase64}
Ciphertext    : ${envelope.ciphertextBase64.slice(0, 180)}...`}
            </pre>
          )}
        </div>
      )}

      {statusMessage && (
        <div className="p-2.5 rounded-md bg-emerald-950/25 border border-emerald-500/30 text-emerald-300 text-[11px]">
          {statusMessage}
        </div>
      )}

      {errorMsg && (
        <div className="p-2.5 rounded-md bg-red-950/30 border border-red-500/30 text-red-300 text-[11px] flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
