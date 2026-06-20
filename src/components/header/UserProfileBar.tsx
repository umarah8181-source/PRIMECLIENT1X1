"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { gsap } from "gsap";
import { cn } from "../../lib/utils";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { RunningInstancesIndicator } from "../process/RunningInstancesIndicator";
import { CurrentAccountDisplay } from "../account/CurrentAccountDisplay";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { MinecraftAccountManager } from "../account/MinecraftAccountManager";
import { NotificationBell } from "./NotificationBell";
import { useFriendsStore } from "../../store/friends-store";
import { useChatStore } from "../../store/chat-store";
import { Icon } from "@iconify/react";
import { NotificationBadge } from "../ui/NotificationBadge";

interface UserProfileBarProps {
  className?: string;
}

export function UserProfileBar({ className }: UserProfileBarProps) {
  const { t } = useTranslation();
  const profileButtonRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const { initializeAccounts } = useMinecraftAuthStore();
  const [_, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    initializeAccounts();
    return () => setMounted(false);
  }, [initializeAccounts]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".profile-bar-container", {
        opacity: 0,
        y: -10,
        duration: 0.5,
        ease: "power3.out",
      });
    });

    return () => ctx.revert();
  }, []);

  const toggleAccountDropdown = () => {
    setIsAccountDropdownOpen(!isAccountDropdownOpen);
  };

  const handleCloseDropdown = () => {
    setIsAccountDropdownOpen(false);
  };

  const chats = useChatStore((state) => state.chats);
  const { toggleSidebar, pendingRequests, currentUser } = useFriendsStore();

  const unreadChatsCount = chats.reduce((acc, c) => acc + (c.unreadMessages || 0), 0);
  const incomingRequestsCount = pendingRequests.filter(
    (r) => r.receiver?.toLowerCase() === currentUser?.uuid?.toLowerCase()
  ).length;

  const totalFriendsUnread = unreadChatsCount + incomingRequestsCount;

  return (
    <div className={cn("relative flex items-center gap-3", className)}>
      <div className="profile-bar-container flex items-center gap-2">
        <NotificationBell />

        <button
          onClick={toggleSidebar}
          className="relative p-2 text-white/70 hover:text-white transition-colors cursor-pointer"
          aria-label="Friends"
        >
          <Icon icon="solar:users-group-rounded-bold" className="w-5 h-5" />
          <NotificationBadge count={totalFriendsUnread} />
        </button>

        <div ref={profileButtonRef}>
          <CurrentAccountDisplay
            onClick={toggleAccountDropdown}
            className="h-10"
          />
        </div>
      </div>

  

      <Dropdown
        ref={dropdownRef}
        isOpen={isAccountDropdownOpen}
        onClose={handleCloseDropdown}
        triggerRef={profileButtonRef}
        width={300}
      >
        <MinecraftAccountManager onClose={handleCloseDropdown} isInDropdown />
      </Dropdown>
    </div>
  );
}
