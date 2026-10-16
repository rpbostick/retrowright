import { useEffect, useRef, useState } from "react";
import { BACKUP_EXTENSION } from "../storage/backup";
import { MEMORY_ONLY_TEXT, PERSISTENCE_TEXT, storageUseText, type Persistence, type StorageUse } from "../storage/persistence";

export interface ExportRequest {
  /** One game's id, or null for everything in this browser. */
  gameId: string | null;
  includeRoms: boolean;
}

interface ExportFormProps {
  gameId: string | null;
  onExport(request: ExportRequest): void;
}

/** Export with its one choice: ROMs are left out unless the player ticks the box. */
export function ExportForm({ gameId, onExport }: ExportFormProps) {
  const [includeRoms, setIncludeRoms] = useState(false);
  return (
    <div className="export-form">
      <label className="check">
        <input type="checkbox" data-item="include-roms" checked={includeRoms} onChange={(event) => setIncludeRoms(event.target.checked)} />
        {gameId === null ? "Include the ROMs" : "Include the ROM"}
      </label>
      <button type="button" data-item="export" data-autofocus="" onClick={() => onExport({ gameId, includeRoms })}>
        {gameId === null ? "Export everything" : "Export this game's saves"}
      </button>
    </div>
  );
}

interface SavesPanelProps {
  /** False when the page keeps its data in memory alone (no IndexedDB); then the browser is never asked. */
  persistent: boolean;
  persistence: Persistence;
  readStorageUse(): Promise<StorageUse | null>;
  onExport(request: ExportRequest): void;
  onImport(file: File): void;
}

/** The library's settings for saves: whether the browser keeps them, how much room they take, export and import. */
export function SavesPanel({ persistent, persistence, readStorageUse, onExport, onImport }: SavesPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [use, setUse] = useState<StorageUse | null | "reading">("reading");

  useEffect(() => {
    let current = true;
    readStorageUse().then(
      (reading) => current && setUse(reading),
      () => current && setUse(null),
    );
    return () => {
      current = false;
    };
  }, [readStorageUse]);

  return (
    <div className="saves-panel">
      {persistent ? (
        <p className={persistence === "denied" || persistence === "unsupported" ? "persistence warning" : "persistence"} data-persistence={persistence}>
          {PERSISTENCE_TEXT[persistence]}
        </p>
      ) : (
        <p className="persistence warning" data-persistence="memory-only">
          {MEMORY_ONLY_TEXT}
        </p>
      )}
      <p className="storage-meter">
        {use === "reading" ? "Reading how much room the page uses…" : use === null ? "This browser does not say how much room the page uses." : storageUseText(use)}
      </p>
      <h3>Export</h3>
      <p className="hint">
        One <code>{BACKUP_EXTENSION}</code> file with every game's battery save, save states with their pictures, resume states, the settings and key bindings. Import it in another browser
        to carry your saves there.
      </p>
      <ExportForm gameId={null} onExport={onExport} />
      <h3>Import</h3>
      <p className="hint">Saves are matched to games by the ROM's contents. Saves for a game not in the library yet wait until you add its ROM. A save here that is as new or newer is kept.</p>
      <button type="button" data-item="import" data-needs-gesture="" onClick={() => inputRef.current?.click()}>
        Import a backup…
      </button>
      <input
        ref={inputRef}
        id="backup-input"
        type="file"
        accept={`${BACKUP_EXTENSION},.json,application/json`}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImport(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
