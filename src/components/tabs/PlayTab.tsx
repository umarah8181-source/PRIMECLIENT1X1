"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { ErrorMessage } from "../ui/ErrorMessage";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { useProfileStore } from "../../store/profile-store";
import { useThemeStore } from "../../store/useThemeStore";
import { PlayerActionsDisplay } from "../launcher/PlayerActionsDisplay";
import { RetroGridEffect } from "../effects/RetroGridEffect";
import {
  BACKGROUND_EFFECTS,
  useBackgroundEffectStore,
} from "../../store/background-effect-store";
// DISABLED: Snow effect (seasonal feature)
// import { SnowEffectToggle } from "../ui/SnowEffectToggle";
import { ReferralBanner } from "../ui/ReferralBanner";
import { useLauncherTheme } from "../../hooks/useLauncherTheme";
import { setDiscordState } from "../../utils/discordRpc";
import { ServerLaunchCard } from "../launcher/ServerLaunchCard";
import { useNavigate } from "react-router-dom";

export function PlayTab() {
  const navigate = useNavigate();
  const {
    profiles,
    selectedProfile: storeSelectedProfile,
    loading,
    error: profilesError,
    setSelectedProfile,
  } = useProfileStore();

  const { activeAccount } = useMinecraftAuthStore();
  const { staticBackground, accentColor } = useThemeStore();
  const { currentEffect } = useBackgroundEffectStore();
  const { isThemeActive, selectedTheme } = useLauncherTheme();

  useEffect(() => { setDiscordState("Idling"); }, []);

  const [servers, setServers] = useState<{ id: string; name: string; address: string; type: "standard" | "partner"; order: number }[]>([]);
  const [serversLoading, setServersLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchServers = async () => {
      try {
        const response = await fetch("https://primeclient.is-best.net/servers.json");
        if (!response.ok) throw new Error("Failed to fetch servers");
        const data = await response.json();
        if (data && active) {
          const parsed = Object.entries(data)
            .filter(([_, val]) => val !== null && typeof val === "object")
            .map(([id, val]: [string, any]) => ({
              id,
              name: val.name || "Minecraft Server",
              address: val.address || "localhost",
              type: val.type || "standard",
              order: Number(val.order) || 0,
            }));
          parsed.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
          setServers(parsed);
        }
      } catch (err) {
        console.error("Error loading servers from Firebase:", err);
      } finally {
        if (active) setServersLoading(false);
      }
    };
    fetchServers();
    return () => { active = false; };
  }, []);

  const customProfiles = profiles.filter((p) => !p.is_standard_version);

  useEffect(() => {
    if (!storeSelectedProfile && customProfiles.length > 0) {
      setSelectedProfile(customProfiles[0]);
    }
  }, [storeSelectedProfile, customProfiles, setSelectedProfile]);

  const handleVersionChange = (versionId: string) => {
    const profileToSelect = customProfiles.find((p) => p.id === versionId) || null;
    setSelectedProfile(profileToSelect);
  };

  const currentDisplayProfile =
    storeSelectedProfile || (customProfiles.length > 0 ? customProfiles[0] : null);

  const versions = customProfiles.map((profile) => ({
    id: profile.id,
    label: `${profile.name}`,
    icon: profile.loader === "vanilla" ? undefined : profile.loader,
    isCustom: profile.loader !== "vanilla",
    profileId: profile.id,
  }));

  return (
    <div className="flex h-full relative">
      <div className="flex-grow flex flex-col items-center justify-center p-8 relative z-20">
        {/* Only show RetroGrid effect if no theme background is active */}
        {currentEffect === BACKGROUND_EFFECTS.RETRO_GRID && !(isThemeActive && selectedTheme?.backgroundImage) && (
          <RetroGridEffect
            renderMode="both"
            isAnimationEnabled={!staticBackground}
            customGridLineColor={`${accentColor.value}80`}
          />
        )}

        {/* Referral Banner - Top Left */}
        <div className="absolute top-3 left-3 z-20">
          <ReferralBanner />
        </div>

        {/* DISABLED: Snow Effect Toggle - Top Right (seasonal feature)
        <div className="absolute top-6 right-6 z-20">
          <SnowEffectToggle variant="compact" size="sm" />
        </div>
        */}

        {/* <VersionInfo
          profileId={currentDisplayProfile?.id || ""}
          className="absolute top-6 left-6 z-10"
        /> */}

        <div className="relative z-10 flex flex-col items-center gap-6">
          {profilesError && !loading && (
            <ErrorMessage
              message={profilesError || "An unknown error occurred"}
            />
          )}

          <PlayerActionsDisplay
            displayMode="playerName"
            playerName={
              activeAccount?.minecraft_username || activeAccount?.username
            }
            launchButtonDefaultVersion={
              storeSelectedProfile?.id || versions[0]?.id || ""
            }
            onLaunchVersionChange={handleVersionChange}
            launchButtonVersions={versions}
            className=""
          />

          {!loading && !serversLoading && (
            <div className="flex flex-col gap-6 max-h-[360px] overflow-y-auto no-scrollbar p-2 w-[570px]">
              {servers.filter(s => s.type === "standard").length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-minecraft-ten text-blue-400 uppercase tracking-wider pl-1 text-left">
                    Standard Servers
                  </h3>
                  {servers.filter(s => s.type === "standard").map((srv) => (
                    <ServerLaunchCard
                      key={srv.id}
                      serverAddress={srv.address}
                      serverName={srv.name}
                      profileId={currentDisplayProfile?.id || null}
                      order={srv.order}
                      onMods={() => {
                        if (currentDisplayProfile?.id) {
                          navigate(`/profilesv2/${currentDisplayProfile.id}`);
                        } else {
                          navigate("/profiles");
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          {serversLoading && (
            <div className="text-white/50 text-sm font-minecraft animate-pulse text-center w-full">
              Loading servers...
            </div>
          )}
        </div>
      </div>

      <div 
        className="w-[300px] border-l-2 bg-black/10 backdrop-blur-lg p-4 overflow-y-auto no-scrollbar flex flex-col relative z-10"
        style={{
          borderLeftColor: `${accentColor.value}60`,
          boxShadow: `0 0 15px ${accentColor.value}30 inset`,
        }}
      >
        <div className="pb-3">
          <div className="flex items-center gap-2">
            <Icon icon="solar:server-bold" className="w-6 h-6 text-yellow-400" />
            <h2 className="text-xl font-minecraft lowercase text-white">Partner Servers</h2>
          </div>
          <hr
            className="mt-2 border-t-2"
            style={{ borderColor: `${accentColor.value}40` }}
          />
        </div>

        <div className="flex-1 flex flex-col gap-3">
          {serversLoading ? (
            <div className="text-white/50 text-sm font-minecraft animate-pulse text-center py-8">
              Loading partner servers...
            </div>
          ) : servers.filter(s => s.type === "partner").length === 0 ? (
            <div className="text-white/50 text-sm font-minecraft italic text-center py-8">
              No partner servers configured.
            </div>
          ) : (
            servers.filter(s => s.type === "partner").map((srv) => (
              <ServerLaunchCard
                key={srv.id}
                serverAddress={srv.address}
                serverName={srv.name}
                profileId={currentDisplayProfile?.id || null}
                className="!min-w-0 w-full"
                compact={true}
                order={srv.order}
                onMods={() => {
                  if (currentDisplayProfile?.id) {
                    navigate(`/profilesv2/${currentDisplayProfile.id}`);
                  } else {
                    navigate("/profiles");
                  }
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
