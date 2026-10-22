import React, { useState } from 'react';
import {
  Lock,
  ShieldCheck,
  RefreshCw,
  Download,
  Upload,
  KeyRound,
  Laptop,
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
  const [deviceName, setDeviceName] = useState('Studio-Workstation-Windows');
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

      // Also push ciphertext envelope to local/remote relay if online
      try {
        await fetch('/api/sync/vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ envelope: encrypted }),
        });
      } catch {
        // Offline mode: stored in local vault queue
      }

      setStatusMessage(
        `Chiffrement E2EE AES-256-GCM réussi (PBKDF2 250k itérations). Hash SHA-256 : ${encrypted.cleartextHashSha256.slice(0, 16)}...`
      );
      onNotify(
        'Synchronisation E2EE terminée',
        `Configuration et diagnostics chiffrés de bout en bout (${encrypted.algorithm}) pour ${deviceName}.`,
        'info'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur de chiffrement E2EE');
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
        // Use local cached envelope if offline
      }

      if (!targetEnvelope) {
        throw new Error('Aucune enveloppe chiffrée trouvée. Chiffrez et synchronisez d’abord un état.');
      }

      const decrypted = await decryptSyncEnvelope<Record<string, unknown>>(targetEnvelope, passphrase);
      setEnvelope(targetEnvelope);
      onRestoreState(decrypted.data);
      setStatusMessage(
        `Déchiffrement vérifié avec succès ! Intégrité SHA-256 : ${decrypted.verifiedIntegrity ? 'AUTHENTIQUE' : 'CORROMPUE'}`
      );
      onNotify(
        'État restauré depuis le coffre E2EE',
        `Synchronisé depuis l'appareil "${targetEnvelope.deviceName}" avec vérification GCM.`,
        'info'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Échec du déchiffrement E2EE');
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
        setStatusMessage(`Bundle E2EE importé et déchiffré depuis ${imported.deviceName}.`);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Fichier E2EE invalide ou phrase secrète erronée');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-slate-300 leading-relaxed">
          <span className="font-semibold text-amber-300">Architecture Zero-Knowledge :</span> Vos clés, préférences de studio et rapports sont chiffrés localement en{' '}
          <code className="text-amber-200 font-mono">AES-256-GCM</code> avant tout transfert. La clé maître ne quitte jamais votre appareil.
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1 flex items-center gap-1">
            <KeyRound className="w-3 h-3 text-indigo-400" />
            Phrase Secrète Maître (PBKDF2)
          </label>
          <div className="relative">
            <input
              type={showPassphrase ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Phrase secrète de chiffrement..."
              className="w-full rounded-lg bg-slate-900/90 border border-slate-700/80 px-2.5 py-1.5 pr-8 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => setShowPassphrase((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              {showPassphrase ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1 flex items-center gap-1">
            <Laptop className="w-3 h-3 text-indigo-400" />
            Nom de l’Appareil Actuel
          </label>
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="w-full rounded-lg bg-slate-900/90 border border-slate-700/80 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={handleEncryptAndSync}
          className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition disabled:opacity-50"
        >
          <Lock className="w-3.5 h-3.5" />
          {busy ? 'Chiffrement...' : 'Chiffrer & Synchroniser'}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={handlePullAndDecrypt}
          className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-medium transition disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Restaurer & Déchiffrer
        </button>
      </div>

      {envelope && (
        <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Coffre E2EE synchronisé ({envelope.algorithm})
            </span>
            <span className="text-slate-400 font-mono">
              {new Date(envelope.syncedAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono text-slate-400">
            <div className="truncate">Appareil: {envelope.deviceName}</div>
            <div className="truncate">KDF: {envelope.kdf} ({envelope.iterations})</div>
            <div className="col-span-2 truncate text-indigo-300">
              SHA-256: {envelope.cleartextHashSha256}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => setShowCipherInspector((v) => !v)}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
            >
              {showCipherInspector ? 'Masquer le payload chiffré' : 'Inspecter le Ciphertext (Preuve Zero-Knowledge)'}
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExportBundle}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 text-[11px]"
              >
                <Download className="w-3 h-3" />
                Exporter .e2ee
              </button>
              <label className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 text-[11px] cursor-pointer">
                <Upload className="w-3 h-3" />
                Importer
                <input type="file" accept=".json" onChange={handleImportBundle} className="hidden" />
              </label>
            </div>
          </div>

          {showCipherInspector && (
            <pre className="p-2 rounded bg-black/80 text-[10px] font-mono text-emerald-300/90 overflow-x-auto max-h-28">
{`IV (96-bit)  : ${envelope.ivBase64}
Salt (128-bit): ${envelope.saltBase64}
Ciphertext   : ${envelope.ciphertextBase64.slice(0, 160)}...`}
            </pre>
          )}
        </div>
      )}

      {statusMessage && (
        <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px]">
          {statusMessage}
        </div>
      )}

      {errorMsg && (
        <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
