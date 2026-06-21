"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

interface UpdateInfo {
  version: string;
  date?: string | null;
  body?: string | null;
  download_url?: string | null;
  original_name?: string | null;
}

interface ClientUpdateModalProps {
  updateInfo: UpdateInfo;
  onClose: () => void;
}

interface UpdaterStatusPayload {
  message: string;
  status: string;
  progress: number | null;
}

export function ClientUpdateModal({ updateInfo, onClose }: ClientUpdateModalProps) {
  const { t } = useTranslation();
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!updating) return;

    let cancelled = false;
    const unlisten = listen<UpdaterStatusPayload>("updater_status", (event: TauriEvent<UpdaterStatusPayload>) => {
      if (cancelled) return;
      
      const payload = event.payload;
      setStatus(payload.message || payload.status);
      if (payload.progress !== undefined && payload.progress !== null) {
        setProgress(payload.progress);
      }
      
      if (payload.status === "finished") {
        toast.success("Update successful. Restarting...");
      } else if (payload.status === "error") {
        setError(payload.message || "Failed to download update");
        setUpdating(false);
      }
    });

    return () => {
      cancelled = true;
      unlisten.then((f) => f());
    };
  }, [updating]);

  const handleUpdate = async () => {
    setUpdating(true);
    setError(null);
    setStatus("Starting update...");
    setProgress(0);
    try {
      await invoke("download_and_install_update_command");
    } catch (err: any) {
      console.error("Update execution failed:", err);
      setError(err?.message || String(err));
      setUpdating(false);
    }
  };

  return (
    <Modal
      title={t("updater.available_title", "Client Update Available")}
      onClose={updating ? () => {} : onClose}
      width="md"
      variant="flat"
    >
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Icon icon="solar:download-bold" className="w-10 h-10 text-accent animate-pulse" />
          <div>
            <h3 className="text-xl font-minecraft text-white lowercase">
              {t("updater.available_message", "You can update the client")}
            </h3>
            <p className="text-sm text-white/50 font-minecraft-ten">
              {t("updater.available_version", "Version {{version}} is now available.", { version: updateInfo.version })}
            </p>
          </div>
        </div>

        {updateInfo.body && (
          <div className="bg-black/20 border border-white/10 p-4 rounded-md max-h-[150px] overflow-y-auto custom-scrollbar">
            <h4 className="text-sm font-minecraft text-white mb-2">{t("updater.changelog", "Changelog:")}</h4>
            <p className="text-xs text-white/70 font-minecraft-ten whitespace-pre-wrap">
              {updateInfo.body}
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-500/30 p-4 rounded-md">
            <p className="text-sm text-red-400 font-minecraft-ten">{error}</p>
          </div>
        )}

        {updating ? (
          <div className="space-y-2 pt-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-minecraft-ten text-white/80">{status}</span>
              {progress !== null && (
                <span className="text-white/60 font-minecraft-ten">{Math.round(progress)}%</span>
              )}
            </div>
            <div className="w-full bg-black/40 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent to-accent-hover transition-all duration-300 ease-out"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <Button variant="ghost" onClick={onClose} size="md">
              {t("updater.later", "Later")}
            </Button>
            <Button variant="default" onClick={handleUpdate} size="md">
              {t("updater.now", "Update Now")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
