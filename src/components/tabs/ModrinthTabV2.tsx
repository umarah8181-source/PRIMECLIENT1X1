"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModrinthSearchV2 } from "../modrinth/v2/ModrinthSearchV2"; // Adjusted import path
import type { Profile } from "../../types/profile";
import { getAllProfilesAndLastPlayed } from "../../services/profile-service";
import { ErrorMessage } from "../ui/ErrorMessage";
import { setDiscordState } from "../../utils/discordRpc";
import { useProfileStore } from "../../store/profile-store";
import { installLocalContentToProfile } from "../../services/content-service";
import { ContentType } from "../../types/content";
import * as ProfileService from "../../services/profile-service";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { useThemeStore } from "../../store/useThemeStore";

interface ModrinthTabV2Props {
  profiles?: Profile[];
}

export function ModrinthTabV2({
  profiles: initialProfiles = [],
}: ModrinthTabV2Props) {
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [profilesLoaded, setProfilesLoaded] = useState(initialProfiles.length > 0);

  const selectedProfile = useProfileStore((state) => state.selectedProfile);
  const accentColor = useThemeStore((state) => state.accentColor);

  useEffect(() => { setDiscordState("Browsing Mods"); }, []);

  useEffect(() => {
    // Only load profiles if they haven't been loaded yet
    if (initialProfiles.length === 0 && !profilesLoaded) {
      const loadProfiles = async () => {
        try {
          const fetched = await getAllProfilesAndLastPlayed();
          setProfiles(fetched.all_profiles);
        } catch (err) {
          console.error("Failed to load profiles:", err);
          setError(
            `Failed to load profiles: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          setProfilesLoaded(true);
        }
      };

      // Use requestIdleCallback for non-critical loading if available
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        (window as any).requestIdleCallback(loadProfiles);
      } else {
        // Fallback to setTimeout with a small delay
        setTimeout(loadProfiles, 10);
      }
    }
  }, [initialProfiles, profilesLoaded]);

  const handleInstallSuccess = useCallback(() => {
    // This might trigger a refresh of profile list or other UI elements
  }, []);

  const handleAddLocalMod = async () => {
    if (!selectedProfile) {
      toast.error("No active profile selected.");
      return;
    }
    
    try {
      const selectedFiles = await open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: "Minecraft Mods",
            extensions: ["jar"],
          },
        ],
        title: "Select Mod Files to Install",
      });

      if (selectedFiles) {
        const paths = Array.isArray(selectedFiles) ? selectedFiles : [selectedFiles];
        if (paths.length === 0) return;
        
        await toast.promise(
          installLocalContentToProfile({
            profile_id: selectedProfile.id,
            file_paths: paths,
            content_type: ContentType.Mod,
          }),
          {
            loading: `Installing ${paths.length} mod(s)...`,
            success: "Mods installed successfully!",
            error: (err) => `Failed to install mods: ${err instanceof Error ? err.message : String(err)}`,
          }
        );
      }
    } catch (err) {
      console.error("Failed to import local mods:", err);
      toast.error(`Error selecting/installing mods: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenModsFolder = async () => {
    if (!selectedProfile) {
      toast.error("No active profile selected.");
      return;
    }
    try {
      await ProfileService.openProfileFolder(selectedProfile.id, "mods");
    } catch (err) {
      console.error("Failed to open mods folder:", err);
      toast.error("Failed to open mods folder.");
    }
  };

  // Memoize the ModrinthSearchV2 component to prevent unnecessary re-renders
  const memoizedSearch = useMemo(
    () => (
      <ModrinthSearchV2
        profiles={profiles}
        onInstallSuccess={handleInstallSuccess}
        className="h-full"
      />
    ),
    [profiles, handleInstallSuccess],
  );

  if (initialProfiles.length === 0 && !profilesLoaded) {
    return null;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      {error && <ErrorMessage message={error} />}

      {/* Local Mods Actions Bar */}
      <div
        className="flex items-center justify-between mb-4 p-3 rounded-lg border backdrop-blur-sm flex-shrink-0"
        style={{
          backgroundColor: `${accentColor.value}15`,
          borderColor: `${accentColor.value}30`,
        }}
      >
        <div className="flex items-center gap-2">
          <Icon icon="solar:widget-bold" className="w-5 h-5" style={{ color: accentColor.value }} />
          <span className="font-minecraft text-lg text-white normal-case">
            Profile Mods: {selectedProfile ? selectedProfile.name : "None Selected"}
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            variant="flat"
            size="sm"
            onClick={handleAddLocalMod}
            disabled={!selectedProfile}
            icon={<Icon icon="solar:add-circle-bold" className="w-5 h-5" />}
          >
            Add Mods from Files
          </Button>
          <Button
            variant="flat-secondary"
            size="sm"
            onClick={handleOpenModsFolder}
            disabled={!selectedProfile}
            icon={<Icon icon="solar:folder-bold" className="w-5 h-5" />}
          >
            Open Mods Folder
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex space-x-4">
        <div className="flex-1 overflow-hidden">{memoizedSearch}</div>
      </div>
    </div>
  );
}

export default ModrinthTabV2;