"use client";

import React, { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { SkinViewer } from './SkinViewer';
import { MainLaunchButton } from './MainLaunchButton';
import { useThemeStore } from '../../store/useThemeStore';
import { MinecraftSkinService } from '../../services/minecraft-skin-service';
import type { GetStarlightSkinRenderPayload, MinecraftSkin } from '../../types/localSkin';
import { useSkinStore } from '../../store/useSkinStore';
import { useMinecraftAuthStore } from '../../store/minecraft-auth-store';
import { convertFileSrc } from '@tauri-apps/api/core';
// DISABLED: ProfileCardV2 was used for featured profile mode
// import { ProfileCardV2 } from '../profiles/ProfileCardV2';
import { useProfileStore } from '../../store/profile-store';
import { Button } from '../ui/buttons/Button';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const DEFAULT_FALLBACK_SKIN_URL = "/skins/default_steve_full.png"; // Defined constant for fallback URL



interface PlayerActionsDisplayProps {
  playerName: string | null | undefined;
  launchButtonDefaultVersion: string;
  onLaunchVersionChange: (versionId: string) => void;
  launchButtonVersions: Array<{ 
    id: string; 
    label: string; 
    icon?: string; 
    isCustom?: boolean; 
    profileId: string; 
  }>;
  className?: string;
  displayMode?: 'playerName' | 'logo';
}

export function PlayerActionsDisplay({
  playerName,
  launchButtonDefaultVersion,
  onLaunchVersionChange,
  launchButtonVersions,
  className,
  displayMode = 'playerName',
}: PlayerActionsDisplayProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [resolvedSkinUrl, setResolvedSkinUrl] = useState<string>(DEFAULT_FALLBACK_SKIN_URL);
  const navigate = useNavigate();

  const { selectedSkinId } = useSkinStore();
  const { activeAccount } = useMinecraftAuthStore();
  const { profiles, loading } = useProfileStore();

  // Determine if we're still loading profiles (no profiles loaded yet)
  const isLoadingProfiles = loading;

  useEffect(() => {
    const fetchAndSetSkin = async () => {
      let activeLocalSkin: MinecraftSkin | undefined;
      if (selectedSkinId) {
        try {
          const skins = await MinecraftSkinService.getAllSkins();
          activeLocalSkin = skins.find(s => s.id === selectedSkinId);
        } catch (err) {
          console.error("[PlayerActionsDisplay] Failed to fetch local skins:", err);
        }
      }

      if (activeLocalSkin) {
        try {
          const payload: GetStarlightSkinRenderPayload = {
            player_name: playerName || "skin",
            render_type: "default",
            render_view: "full",
            base64_skin_data: activeLocalSkin.base64_data,
          };
          console.log("[PlayerActionsDisplay] Fetching skin from local base64. Payload:", payload);
          const localPath = await MinecraftSkinService.getStarlightSkinRender(payload);
          if (localPath) {
            setResolvedSkinUrl(convertFileSrc(localPath));
            return;
          }
        } catch (error) {
          console.error("[PlayerActionsDisplay] Failed to fetch starlight skin render for local skin:", error);
        }
      }

      if (playerName && activeAccount?.auth_flow !== "Offline") {
        try {
          const payload: GetStarlightSkinRenderPayload = {
            player_name: playerName,
            render_type: "default", 
            render_view: "full",    
          };
          console.log("[PlayerActionsDisplay] Fetching skin for player:", playerName, "Payload:", payload);
          const localPath = await MinecraftSkinService.getStarlightSkinRender(payload);
          if (localPath) {
            setResolvedSkinUrl(convertFileSrc(localPath));
          } else {
            setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
          }
        } catch (error) {
          console.error("[PlayerActionsDisplay] Failed to fetch starlight skin render:", error);
          setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
        }
      } else {
        setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
      }
    };

    fetchAndSetSkin();
  }, [playerName, selectedSkinId, activeAccount]);

  const dropShadowX = '2px';
  const dropShadowY = '4px';
  const dropShadowBlur = '6px';
  const commonDropShadowStyle = `drop-shadow(${dropShadowX} ${dropShadowY} ${dropShadowBlur} ${accentColor.value})`;
  
  const skinViewerDisplayHeight = 450;
  const skinViewerMaxDisplayWidth = 225;

  const skinViewerStyles: React.CSSProperties = {
    filter: 'drop-shadow(5px 10px 5px rgba(0,0,0,0.75))',
    WebkitBoxReflect: 'below 0px linear-gradient(to bottom, transparent, rgba(0,0,0,0.05))',
    height: `${skinViewerDisplayHeight}px`,
    width: 'auto',
    maxWidth: `${skinViewerMaxDisplayWidth}px`,
  };

  const selectedVersionLabel = launchButtonVersions.find(v => v.id === launchButtonDefaultVersion)?.label;

  return (
    <div className={cn("flex flex-col items-center", className)}>

      {displayMode === 'logo' ? (
        <img
          src="prime_logo_color.png"
          alt="Prime Logo"
          className="h-48 sm:h-56 md:h-64 mb-[-80px] sm:mb-[-100px] md:mb-[-120px] relative z-0"
          style={{
            imageRendering: "pixelated",
            filter: commonDropShadowStyle
          }}
        />
      ) : (
        <h2 className="font-minecraft text-6xl text-center text-white mb-2 lowercase font-normal">
          {playerName || "no account"}
        </h2>
      )}

      <div className="relative w-full max-w-[500px] flex flex-col items-center">
        <SkinViewer
          skinUrl={resolvedSkinUrl} 
          playerName={playerName?.toString()} 
          width={skinViewerMaxDisplayWidth} 
          height={skinViewerDisplayHeight} 
          className="bg-transparent flex-shrink-0"
          style={skinViewerStyles}
        />

        {/* Don't render launch button while profiles are still loading to prevent flicker */}
        {!isLoadingProfiles && (
          <div className="absolute bottom-8 left-0 right-0 flex justify-center px-4">
            <div className="max-w-xs sm:max-w-sm">
              {launchButtonVersions.length === 0 ? (
                <Button
                  onClick={() => navigate("/profiles")}
                  variant="3d"
                  size="xl"
                  className="w-80"
                  heightClassName="h-20"
                >
                  <div className="w-full flex flex-col items-center justify-center leading-none -mt-4">
                    <span className="text-5xl text-center lowercase">create profile</span>
                    <span className="text-xs font-minecraft-ten tracking-normal -mt-1 text-center opacity-85">
                      no profiles found
                    </span>
                  </div>
                </Button>
              ) : (
                <MainLaunchButton
                  defaultVersion={launchButtonDefaultVersion}
                  onVersionChange={onLaunchVersionChange}
                  versions={launchButtonVersions}
                  selectedVersionLabel={selectedVersionLabel}
                  mainButtonWidth="w-80"
                  maxWidth="400px"
                  mainButtonHeight="h-20"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 