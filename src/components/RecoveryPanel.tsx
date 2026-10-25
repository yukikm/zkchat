import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";

/** Recovery secrets stay in this component's memory and the user's download. */
export function RecoveryPanel({
  mode,
  incomplete,
  restoreInterrupted = false,
  disabled,
  createFile,
  onEnable,
  onRestore,
  onCancel,
}: {
  mode: "setup" | "restore";
  incomplete: boolean;
  restoreInterrupted?: boolean;
  disabled: boolean;
  createFile?: () => string;
  onEnable: (file: string) => Promise<void>;
  onRestore: (file: string, finishSetup: boolean) => Promise<void>;
  onCancel?: () => void;
}) {
  const [downloadedFile, setDownloadedFile] = useState("");
  const [uploadedFile, setUploadedFile] = useState("");
  const [saved, setSaved] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const readVersion = useRef(0);
  useEffect(
    () => () => {
      readVersion.current++;
    },
    [],
  );
  // Closing the panel clears its secrets. An interrupted setup reopened later
  // must accept the original downloaded file instead of generating a new one.
  const setup = mode === "setup" && !(incomplete && !downloadedFile);
  const file = setup ? downloadedFile : uploadedFile;

  function download() {
    if (disabled || !createFile) return;
    try {
      const text = downloadedFile || createFile();
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "zkchat-deposit-recovery.json";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDownloadedFile(text);
      setError("");
    } catch {
      setError(
        "Could not save the recovery file. Try again before continuing.",
      );
    }
  }

  async function readFile(selected?: File) {
    const version = ++readVersion.current;
    setUploadedFile("");
    setError("");
    if (!selected) return;
    if (selected.size > 64 * 1024) {
      setError("Choose the small JSON recovery file you saved from zkChat.");
      return;
    }
    setReading(true);
    try {
      const text = await selected.text();
      if (version !== readVersion.current) return;
      try {
        JSON.parse(text);
      } catch {
        throw new Error("invalid JSON");
      }
      setUploadedFile(text);
    } catch {
      if (version === readVersion.current)
        setError(
          "Could not read this file. Choose your zkChat recovery JSON file.",
        );
    } finally {
      if (version === readVersion.current) setReading(false);
    }
  }

  return (
    <section
      className="connection-step recovery-panel"
      aria-label={setup ? "Back up deposits" : "Restore deposits"}
    >
      <p>
        {restoreInterrupted
          ? "Restoration was interrupted. Keep this file and retry to finish opening your deposits here."
          : incomplete
            ? "Setup was interrupted. Use the same recovery file to finish safely."
            : setup
              ? "Save this file once. You only need it if you lose browser data or move to another device—not for everyday chats."
              : "Choose your recovery file and connect the same wallet to open your saved deposits here."}
      </p>
      {setup && (
        <p className="small muted">
          Later deposits are backed up automatically.
        </p>
      )}
      {setup ? (
        <>
          <button
            type="button"
            className={downloadedFile ? "text-button" : "primary"}
            disabled={disabled}
            onClick={download}
          >
            <Download size={16} />
            {downloadedFile
              ? "Download recovery file again"
              : "Download recovery file"}
          </button>
          {downloadedFile && (
            <>
              <p className="small recovery-filename">
                zkchat-deposit-recovery.json
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={saved}
                  disabled={disabled}
                  onChange={(e) => setSaved(e.target.checked)}
                />
                I saved this file somewhere I can find later
              </label>
            </>
          )}
        </>
      ) : (
        <div className="field">
          <label htmlFor="deposit-recovery-file">Recovery file</label>
          <input
            id="deposit-recovery-file"
            type="file"
            accept=".json,application/json"
            disabled={disabled || reading}
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
        </div>
      )}
      <p className="small muted">
        Keep this file private. Anyone with it can access your deposits.
      </p>
      {(!setup || downloadedFile) && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={stopped}
            disabled={disabled}
            onChange={(e) => setStopped(e.target.checked)}
          />
          I closed zkChat on my other tabs and devices
        </label>
      )}
      {!setup && (
        <p className="small muted">
          Use one browser at a time. Restoring replaces access on the previous
          device.
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {(!setup || downloadedFile) && (
        <button
          type="button"
          className="primary"
          disabled={
            disabled || reading || !file || !stopped || (setup && !saved)
          }
          onClick={() =>
            void (setup && !incomplete
              ? onEnable(file)
              : onRestore(file, incomplete))
          }
        >
          {!setup && <Upload size={16} />}
          {disabled
            ? "Opening your deposits…"
            : incomplete
              ? "Finish recovery setup"
              : setup
                ? "Continue to deposit"
                : "Restore deposits"}
        </button>
      )}
      <details className="connection-details">
        <summary>What this file restores</summary>
        <p className="small muted">
          Recovery uses an encrypted copy kept by the recovery service. It needs
          that service to remain available. Your file does not include chat
          history or extend withdrawal deadlines.
        </p>
      </details>
      {onCancel && (
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={onCancel}
        >
          Back
        </button>
      )}
    </section>
  );
}
