"use client";

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import { useServerPingStore } from "../../store/server-ping-store";
import { parseMotdToHtml } from "../../utils/motd-utils";
import { useProfileLaunch } from "../../hooks/useProfileLaunch";
import { LaunchState } from "../../store/launch-state-store";
import type { ServerPingInfo } from "../../types/minecraft";
import { addServerToMultiplayerList } from "../../services/world-service";
import { useFriendsStore } from "../../store/friends-store";

interface ServerLaunchCardProps {
  serverAddress: string;
  serverName: string;
  profileId: string | null;
  onMods?: () => void;
  className?: string;
  compact?: boolean;
  order?: number;
}

export function ServerLaunchCard({
  serverAddress,
  serverName,
  profileId,
  onMods,
  className = "",
  compact = false,
  order = 0,
}: ServerLaunchCardProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [serverInfo, setServerInfo] = useState<ServerPingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const accentColor = useThemeStore((state) => state.accentColor);
  const getPing = useServerPingStore((state) => state.getPing);
  const subscribe = useServerPingStore((state) => state.subscribe);
  const triggerBackgroundPing = useServerPingStore((state) => state.triggerBackgroundPing);

  // Use the profile launch hook for launch logic
  const {
    isLaunching,
    statusMessage,
    launchState,
    handleQuickPlayLaunch
  } = useProfileLaunch({
    profileId: profileId || "",
    quickPlayMultiplayer: serverAddress,
    onLaunchSuccess: () => {
      console.log(`[ServerLaunchCard] Launch successful for ${serverAddress}`);
      useFriendsStore.getState().setLaunchedServer(serverAddress);
    },
    onLaunchError: (error) => {
      console.error(`[ServerLaunchCard] Launch error:`, error);
    },
  });

  // Get cached ping on mount and subscribe to updates
  useEffect(() => {
    // Get cached value immediately (may be null on first load)
    const cached = getPing(serverAddress);
    if (cached) {
      setServerInfo(cached);
      setIsLoading(false);
    }

    // Subscribe to updates from background pings
    const unsubscribe = subscribe(serverAddress, (info) => {
      setServerInfo(info);
      setIsLoading(false);
    });

    // Refresh every 30 seconds in background
    const interval = setInterval(() => {
      triggerBackgroundPing(serverAddress);
    }, 30000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [serverAddress, getPing, subscribe, triggerBackgroundPing]);

  // 3D styling (matching ProfileCardV2)
  const get3DStyling = () => {
    const colors = {
      main: isLaunching ? "#ef4444" : accentColor.value, // Red when launching (stop mode)
      light: isLaunching ? "#f87171" : (accentColor.hoverValue || accentColor.value),
      dark: isLaunching ? "#dc2626" : accentColor.value,
    };

    const shadowDepth = "short";
    const backgroundColor = isHovered ? `${colors.main}50` : `${colors.main}30`;
    const borderColor = isHovered ? colors.light : `${colors.main}80`;
    const borderBottomColor = isHovered ? colors.light : colors.dark;

    const part1Y = shadowDepth === "short" ? "4px" : "8px";
    const part2Y = shadowDepth === "short" ? "6px" : "10px";
    const part2Blur = shadowDepth === "short" ? "10px" : "15px";
    const boxShadow = `0 ${part1Y} 0 rgba(0,0,0,0.3), 0 ${part2Y} ${part2Blur} rgba(0,0,0,0.35), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`;

    return {
      backgroundColor,
      border: `2px solid ${borderColor}`,
      borderBottom: `4px solid ${borderBottomColor}`,
      boxShadow,
      transform: isHovered ? "translateY(-2px)" : "translateY(0)",
    };
  };

  const handleClick = async () => {
    if (!profileId) return;
    // Save server to Minecraft's multiplayer list before launching
    try {
      await addServerToMultiplayerList(profileId, serverName, serverAddress);
      console.log(`[ServerLaunchCard] Saved server '${serverName}' to multiplayer list`);
    } catch (error) {
      console.warn(`[ServerLaunchCard] Failed to save server to multiplayer list:`, error);
      // Don't block launch if saving fails
    }
    handleQuickPlayLaunch(undefined, serverAddress);
  };

  // Parse MOTD to HTML
  const motdHtml = serverInfo?.description_json
    ? parseMotdToHtml(serverInfo.description_json)
    : serverInfo?.description
      ? parseMotdToHtml(serverInfo.description)
      : null;

  // Determine what to show in the content area
  const renderContent = () => {
    // When launching, show status message instead of MOTD
    if (isLaunching && statusMessage) {
      return (
        <div className="flex flex-col items-start justify-center w-full">
          <span className={`text-white font-minecraft-ten ${compact ? 'text-[10px]' : 'text-sm'}`}>
            {statusMessage}
          </span>
        </div>
      );
    }

    // Show "STARTING!" briefly after success
    if (statusMessage === "STARTING!") {
      return (
        <div className="flex flex-col items-start justify-center w-full">
          <span className={`text-green-400 font-minecraft-ten ${compact ? 'text-xs' : 'text-lg'}`}>
            STARTING!
          </span>
        </div>
      );
    }

    // Show error state
    if (launchState === LaunchState.ERROR && statusMessage) {
      return (
        <div className="flex flex-col items-start justify-center w-full">
          <span className={`text-red-400 font-minecraft-ten ${compact ? 'text-[10px]' : 'text-sm'}`}>
            {statusMessage}
          </span>
        </div>
      );
    }

    // Default: Show Server Name + MOTD (or Server Address) left-aligned!
    return (
      <div className="flex flex-col items-start justify-center w-full min-w-0">
        {/* Server Name */}
        <div className={`text-white font-bold font-minecraft-ten truncate w-full text-left ${compact ? 'text-xs' : 'text-sm'}`}>
          {order > 0 ? `#${order} ` : ''}{serverName}
        </div>

        {/* MOTD / Status description */}
        <div
          className={`${compact ? 'text-[9px] mt-0.5' : 'text-xs mt-1'} motd-container font-sans w-full whitespace-pre-line text-left truncate text-white/60`}
          title={serverInfo?.description || serverAddress}
        >
          {isLoading && !serverInfo ? (
            <span className="italic text-white/40">{t('server.pinging')}</span>
          ) : motdHtml ? (
            <span
              dangerouslySetInnerHTML={{ __html: motdHtml }}
            />
          ) : (
            <span className="text-white/40">{serverAddress}</span>
          )}
        </div>

        {/* Player count + Ping - left-aligned */}
        {serverInfo && (
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-white/50 font-minecraft-ten ${compact ? 'text-[8px]' : 'text-[10px]'}`}>
              {serverInfo.players_online ?? "?"}/{serverInfo.players_max ?? "?"} {compact ? '' : t('server.players')}
            </span>
            <img
              src={`/minecraft/ping_${
                serverInfo.latency_ms === null ? 'unknown' :
                serverInfo.latency_ms < 80 ? '5' :
                serverInfo.latency_ms < 100 ? '4' :
                serverInfo.latency_ms < 150 ? '3' :
                serverInfo.latency_ms < 300 ? '2' : '1'
              }.png`}
              alt="ping"
              className={compact ? "h-2" : "h-3"}
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        )}
      </div>
    );
  };

  const isDisabled = !profileId;

  return (
    <div
      className={`relative flex items-center transition-all duration-200 cursor-pointer w-full rounded-lg backdrop-blur-md ${
        compact ? 'gap-2 p-2 max-w-[280px]' : 'gap-4 p-4 max-w-[550px]'
      } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      style={get3DStyling()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={isDisabled ? undefined : handleClick}
    >
      {/* Server Icon */}
      <div className={`relative flex-shrink-0 rounded flex items-center justify-center overflow-hidden ${
        compact ? 'w-10 h-10' : 'w-16 h-16'
      }`}>
        {isLaunching ? (
          <Icon
            icon="solar:refresh-bold"
            className={`${compact ? 'w-5 h-5' : 'w-8 h-8'} text-white/70 animate-spin`}
          />
        ) : isLoading ? (
          <Icon
            icon="solar:refresh-bold"
            className={`${compact ? 'w-5 h-5' : 'w-8 h-8'} text-white/50 animate-spin`}
          />
        ) : serverInfo?.favicon_base64 ? (
          <img
            src={`data:image/png;base64,${serverInfo.favicon_base64}`}
            alt={serverName}
            className="w-full h-full object-cover"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <Icon
            icon="solar:server-square-bold"
            className={`${compact ? 'w-5 h-5' : 'w-8 h-8'} text-white/70`}
          />
        )}
      </div>

      {/* Content Area (MOTD or Status) - fixed height to prevent layout shifts */}
      <div className={`flex-1 min-w-0 flex flex-col justify-center ${compact ? 'min-h-[30px]' : 'min-h-[48px]'}`}>
        {renderContent()}
      </div>

      {/* Action Buttons */}
      <div className="flex-shrink-0">
        {/* Join/Stop Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isDisabled) return;
            handleClick();
          }}
          disabled={isDisabled}
          className={`${
            compact ? 'w-16 h-6 gap-1' : 'w-20 h-8 gap-1.5'
          } flex items-center justify-center rounded transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 hover:brightness-110 active:scale-95`}
          style={{
            backgroundColor: isLaunching ? '#ef444460' : `${accentColor.value}35`,
            border: `2px solid ${isLaunching ? '#ef444490' : `${accentColor.value}60`}`,
          }}
        >
          <Icon
            icon={isLaunching ? "solar:stop-bold" : "solar:play-bold"}
            className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} text-white`}
          />
          <span className={`font-minecraft-ten text-white uppercase ${compact ? 'text-[9px]' : 'text-xs'}`}>
            {isLaunching ? t('server.stop') : t('server.join')}
          </span>
        </button>
      </div>
    </div>
  );
}
