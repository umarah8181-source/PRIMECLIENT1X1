import { useEffect, useState, useMemo } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useFriendsStore, FriendsFriendUser, OnlineState } from "../../store/friends-store";
import { useThemeStore } from "../../store/useThemeStore";
import { FriendListItem } from "./FriendListItem";
import { FriendRequestItem } from "./FriendRequestItem";
import { FriendSkeleton } from "./FriendSkeleton";
import { AddFriendInput } from "./AddFriendInput";
import { ChatPanel } from "../chat/ChatPanel";
import { SettingsPanel } from "./SettingsPanel";
import { toast } from "../ui/GlobalToaster";
import { cn } from "../../lib/utils";
import { Virtuoso } from "react-virtuoso";

type FriendListRow =
  | { type: "header"; status: "online" | "offline"; count: number }
  | { type: "friend"; friend: FriendsFriendUser };

type TabType = "friends" | "requests";

export function FriendsSidebar() {
  const { t } = useTranslation();
  const {
    friends,
    pendingRequests,
    currentUser,
    friendsAccount,
    isLoading,
    isSidebarOpen,
    isSettingsOpen,
    activeChatFriend,
    notificationsEnabled,
    closeSidebar,
    closeChat,
    closeSettings,
    loadFriends,
    loadPendingRequests,
    toggleNotifications,
    openSettings,
  } = useFriendsStore();

  const { accentColor } = useThemeStore();
  const [activeTab, setActiveTab] = useState<TabType>("friends");
  const [searchQuery, setSearchQuery] = useState("");

  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    if (isSidebarOpen && friendsAccount) {
      loadFriends();
      loadPendingRequests();
    }
  }, [isSidebarOpen, friendsAccount]);

  const handleClose = () => {
    closeChat();
    closeSettings();
    closeSidebar();
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUsername.trim() || !authPassword.trim() || authLoading) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (authMode === "login") {
        await useFriendsStore.getState().loginFriendsAccount(authUsername, authPassword);
      } else {
        await useFriendsStore.getState().registerFriendsAccount(authUsername, authPassword);
      }
      setAuthUsername("");
      setAuthPassword("");
    } catch (err: any) {
      setAuthError(err.message || String(err));
    } finally {
      setAuthLoading(false);
    }
  };

  const onlineFriends = useMemo(() =>
    friends.filter((f) => f && ["ONLINE", "AFK", "BUSY"].includes(f.state)),
    [friends]
  );
  const offlineFriends = useMemo(() =>
    friends.filter((f) => f && ["OFFLINE", "INVISIBLE"].includes(f.state)),
    [friends]
  );

  const incomingRequests = useMemo(() => {
    if (!friendsAccount) return [];
    return pendingRequests.filter((r) => r.receiver?.toLowerCase() === friendsAccount.uuid?.toLowerCase());
  }, [pendingRequests, friendsAccount]);

  const outgoingRequests = useMemo(() => {
    if (!friendsAccount) return [];
    return pendingRequests.filter((r) => r.sender?.toLowerCase() === friendsAccount.uuid?.toLowerCase());
  }, [pendingRequests, friendsAccount]);

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300",
          isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={handleClose}
      />

      <div
        className={cn(
          "fixed top-0 right-0 h-full z-50 flex transition-transform duration-300 ease-out",
          isSidebarOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div
          className={cn(
            "h-full flex flex-col transition-all duration-300 ease-out overflow-hidden backdrop-blur-md",
            (activeChatFriend || isSettingsOpen) ? "w-[380px] opacity-100" : "w-0 opacity-0"
          )}
          style={{
            background: `linear-gradient(135deg, ${accentColor.value}40 0%, ${accentColor.value}30 50%, ${accentColor.value}35 100%)`,
            borderLeft: (activeChatFriend || isSettingsOpen) ? `2px solid ${accentColor.value}50` : "none",
            boxShadow: (activeChatFriend || isSettingsOpen) ? `inset 0 0 100px ${accentColor.value}25` : "none",
          }}
        >
          {activeChatFriend && <ChatPanel friend={activeChatFriend} />}
          {isSettingsOpen && !activeChatFriend && <SettingsPanel />}
        </div>

        <div
          className="w-96 h-full flex flex-col backdrop-blur-md"
          style={{
            background: `linear-gradient(180deg, ${accentColor.value}45 0%, ${accentColor.value}35 30%, ${accentColor.value}40 100%)`,
            borderLeft: `2px solid ${accentColor.value}60`,
            boxShadow: `inset 0 0 120px ${accentColor.value}30, -5px 0 20px rgba(0, 0, 0, 0.5)`,
          }}
        >
          {!friendsAccount ? (
            /* Login / Registration Screen */
            <div className="h-full flex flex-col">
              <div className="p-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${accentColor.value}30` }}>
                <h2 className="text-lg font-bold text-white font-minecraft-ten uppercase tracking-wide">
                  {t('friends.title')}
                </h2>
                <button
                  onClick={handleClose}
                  className="p-2 rounded-full transition-all duration-200 hover:scale-105"
                  style={{ backgroundColor: `${accentColor.value}20`, border: `1px solid ${accentColor.value}50`, color: accentColor.value }}
                  title={t('common.close')}
                >
                  <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 flex flex-col justify-center px-6 py-8 overflow-y-auto">
                <div className="text-center mb-6">
                  <Icon icon="solar:users-group-rounded-bold" className="w-16 h-16 mx-auto mb-3 animate-pulse" style={{ color: accentColor.value }} />
                  <h3 className="text-xl font-bold text-white font-minecraft-ten">
                    {authMode === "login" ? "Welcome Back!" : "Create Friends Account"}
                  </h3>
                  <p className="text-xs text-white/50 font-minecraft mt-1">
                    {authMode === "login" ? "Login to chat and play with friends." : "Register a custom username to get started."}
                  </p>
                </div>

                <div
                  className="flex rounded-xl p-1 mb-6"
                  style={{ backgroundColor: `${accentColor.value}15`, border: `1px solid ${accentColor.value}40` }}
                >
                  <button
                    onClick={() => { setAuthMode("login"); setAuthError(null); }}
                    className="flex-1 py-2 px-4 rounded-lg text-sm font-minecraft-ten transition-all duration-200"
                    style={{
                      backgroundColor: authMode === "login" ? `${accentColor.value}40` : "transparent",
                      color: authMode === "login" ? "white" : "rgba(255,255,255,0.5)",
                      border: authMode === "login" ? `1px solid ${accentColor.value}60` : "1px solid transparent",
                    }}
                  >
                    Login
                  </button>
                  <button
                    onClick={() => { setAuthMode("register"); setAuthError(null); }}
                    className="flex-1 py-2 px-4 rounded-lg text-sm font-minecraft-ten transition-all duration-200"
                    style={{
                      backgroundColor: authMode === "register" ? `${accentColor.value}40` : "transparent",
                      color: authMode === "register" ? "white" : "rgba(255,255,255,0.5)",
                      border: authMode === "register" ? `1px solid ${accentColor.value}60` : "1px solid transparent",
                    }}
                  >
                    Register
                  </button>
                </div>

                <form onSubmit={handleAuthSubmit} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-minecraft-ten text-white/70 uppercase">Username</label>
                    <div
                      className="flex items-center gap-2 rounded-xl border transition-all duration-200"
                      style={{
                        backgroundColor: "rgba(0,0,0,0.25)",
                        borderColor: `${accentColor.value}40`
                      }}
                    >
                      <Icon icon="solar:user-bold" className="w-5 h-5 ml-4 flex-shrink-0" style={{ color: `${accentColor.value}70` }} />
                      <input
                        type="text"
                        required
                        value={authUsername}
                        onChange={(e) => { setAuthUsername(e.target.value); setAuthError(null); }}
                        placeholder="Enter username"
                        className="flex-1 bg-transparent py-3 pr-3 text-white font-minecraft-ten placeholder:text-white/20 focus:outline-none"
                        style={{ fontSize: "14px" }}
                        disabled={authLoading}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-minecraft-ten text-white/70 uppercase">Password</label>
                    <div
                      className="flex items-center gap-2 rounded-xl border transition-all duration-200"
                      style={{
                        backgroundColor: "rgba(0,0,0,0.25)",
                        borderColor: `${accentColor.value}40`
                      }}
                    >
                      <Icon icon="solar:lock-password-bold" className="w-5 h-5 ml-4 flex-shrink-0" style={{ color: `${accentColor.value}70` }} />
                      <input
                        type="password"
                        required
                        value={authPassword}
                        onChange={(e) => { setAuthPassword(e.target.value); setAuthError(null); }}
                        placeholder="Enter password"
                        className="flex-1 bg-transparent py-3 pr-3 text-white font-minecraft-ten placeholder:text-white/20 focus:outline-none"
                        style={{ fontSize: "14px" }}
                        disabled={authLoading}
                      />
                    </div>
                  </div>

                  {authError && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg font-minecraft-ten text-xs text-red-400 bg-red-500/10 border border-red-500/20">
                      <Icon icon="solar:danger-circle-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span className="break-words min-w-0">{authError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full flex items-center justify-center py-3.5 px-4 rounded-xl text-white font-minecraft-ten text-sm font-bold uppercase tracking-wider transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      backgroundColor: accentColor.value,
                      boxShadow: `0 4px 15px ${accentColor.value}50`,
                    }}
                  >
                    {authLoading ? (
                      <Icon icon="solar:refresh-bold" className="w-5 h-5 animate-spin" />
                    ) : (
                      authMode === "login" ? "Login" : "Register"
                    )}
                  </button>
                </form>
              </div>
            </div>
          ) : (
            /* Normal Friends Sidebar content (when logged in) */
            <>
              <div className="p-4" style={{ borderBottom: `1px solid ${accentColor.value}30` }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={openSettings}
                      className="p-2 rounded-full transition-all duration-200 hover:scale-105"
                      style={{
                        backgroundColor: isSettingsOpen ? `${accentColor.value}40` : `${accentColor.value}20`,
                        border: `1px solid ${isSettingsOpen ? `${accentColor.value}70` : `${accentColor.value}50`}`,
                      }}
                      title={t('common.settings')}
                    >
                      <Icon icon="solar:settings-bold" className="w-5 h-5" style={{ color: accentColor.value }} />
                    </button>
                    <h2 className="text-lg font-bold text-white font-minecraft-ten uppercase tracking-wide">
                      {t('friends.title')}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { loadFriends(true); loadPendingRequests(); }}
                      className="p-2 rounded-full transition-all duration-200 hover:scale-105"
                      style={{ backgroundColor: `${accentColor.value}20`, border: `1px solid ${accentColor.value}50`, color: accentColor.value }}
                      title={t('common.refresh')}
                    >
                      <Icon icon="solar:refresh-bold" className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => {
                        toggleNotifications();
                        toast.info(notificationsEnabled ? t('friends.notifications_disabled') : t('friends.notifications_enabled'));
                      }}
                      className="p-2 rounded-full transition-all duration-200 hover:scale-105"
                      style={{
                        backgroundColor: notificationsEnabled ? `${accentColor.value}20` : "rgba(239, 68, 68, 0.2)",
                        border: `1px solid ${notificationsEnabled ? `${accentColor.value}50` : "rgba(239, 68, 68, 0.5)"}`,
                        color: notificationsEnabled ? accentColor.value : "#ef4444",
                      }}
                      title={notificationsEnabled ? t('friends.disable_notifications') : t('friends.enable_notifications')}
                    >
                      <Icon icon={notificationsEnabled ? "solar:bell-bold" : "solar:bell-off-bold"} className="w-5 h-5" />
                    </button>
                    <button
                      onClick={handleClose}
                      className="p-2 rounded-full transition-all duration-200 hover:scale-105"
                      style={{ backgroundColor: `${accentColor.value}20`, border: `1px solid ${accentColor.value}50`, color: accentColor.value }}
                      title={t('common.close')}
                    >
                      <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-3" style={{ borderBottom: `1px solid ${accentColor.value}30` }}>
                <div
                  className="flex rounded-xl p-1"
                  style={{ backgroundColor: `${accentColor.value}15`, border: `1px solid ${accentColor.value}40` }}
                >
                  <button
                    onClick={() => setActiveTab("friends")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-minecraft-ten transition-all duration-200"
                    )}
                    style={{
                      backgroundColor: activeTab === "friends" ? `${accentColor.value}40` : "transparent",
                      color: activeTab === "friends" ? "white" : "rgba(255,255,255,0.5)",
                      border: activeTab === "friends" ? `1px solid ${accentColor.value}60` : "1px solid transparent",
                    }}
                  >
                    <Icon icon="solar:users-group-rounded-bold" className="w-4 h-4" />
                    {t('friends.tab_friends')}
                  </button>
                  <button
                    onClick={() => setActiveTab("requests")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-minecraft-ten transition-all duration-200"
                    )}
                    style={{
                      backgroundColor: activeTab === "requests" ? `${accentColor.value}40` : "transparent",
                      color: activeTab === "requests" ? "white" : "rgba(255,255,255,0.5)",
                      border: activeTab === "requests" ? `1px solid ${accentColor.value}60` : "1px solid transparent",
                    }}
                  >
                    <Icon icon="solar:letter-bold" className="w-4 h-4" />
                    {t('friends.tab_requests')}
                    {incomingRequests.length > 0 && (
                      <span
                        className="text-xs font-minecraft-ten"
                        style={{ color: accentColor.value }}
                      >
                        {incomingRequests.length > 99 ? "99+" : incomingRequests.length}
                      </span>
                    )}
                  </button>
                </div>

                {activeTab === "friends" && (
                  <div
                    className="flex items-center gap-3 px-4 py-3 rounded-xl mt-3"
                    style={{
                      backgroundColor: `${accentColor.value}15`,
                      border: `1px solid ${accentColor.value}40`,
                    }}
                  >
                    <Icon icon="solar:magnifer-bold" className="w-5 h-5" style={{ color: `${accentColor.value}80` }} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('friends.search_placeholder')}
                      className="flex-1 bg-transparent text-white text-sm font-minecraft-ten placeholder:text-white/30 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {activeTab === "friends" ? (
                  <FriendsTab
                    currentUser={currentUser}
                    onlineFriends={onlineFriends.filter(f => f.username.toLowerCase().includes(searchQuery.toLowerCase()))}
                    offlineFriends={offlineFriends.filter(f => f.username.toLowerCase().includes(searchQuery.toLowerCase()))}
                    isLoading={isLoading}
                    accentColor={accentColor.value}
                  />
                ) : (
                  <RequestsTab
                    incomingRequests={incomingRequests}
                    outgoingRequests={outgoingRequests}
                    accentColor={accentColor.value}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function FriendsTab({
  currentUser,
  onlineFriends,
  offlineFriends,
  isLoading,
  accentColor,
}: {
  currentUser: ReturnType<typeof useFriendsStore.getState>["currentUser"];
  onlineFriends: ReturnType<typeof useFriendsStore.getState>["friends"];
  offlineFriends: ReturnType<typeof useFriendsStore.getState>["friends"];
  isLoading: boolean;
  accentColor: string;
}) {
  const { t } = useTranslation();
  
  const listItems = useMemo<FriendListRow[]>(() => {
    const items: FriendListRow[] = [];

    if (onlineFriends.length > 0) {
      items.push({ type: "header", status: "online", count: onlineFriends.length });
      onlineFriends.forEach((friend) => {
        items.push({ type: "friend", friend });
      });
    }

    if (offlineFriends.length > 0) {
      items.push({ type: "header", status: "offline", count: offlineFriends.length });
      offlineFriends.forEach((friend) => {
        items.push({ type: "friend", friend });
      });
    }

    return items;
  }, [onlineFriends, offlineFriends]);

  if (isLoading) {
    return (
      <div className="p-3 space-y-3">
        {[...Array(5)].map((_, i) => (
          <FriendSkeleton key={i} accentColor={accentColor} />
        ))}
      </div>
    );
  }

  if (onlineFriends.length === 0 && offlineFriends.length === 0) {
    return (
      <div className="py-12 text-center">
        <div
          className="w-16 h-16 mx-auto mb-4 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${accentColor}15`, border: `1px solid ${accentColor}40` }}
        >
          <Icon icon="solar:users-group-rounded-bold" className="w-8 h-8" style={{ color: accentColor }} />
        </div>
        <p className="text-white/50 text-xs font-minecraft-ten">{t('friends.no_friends_title')}</p>
        <p className="text-white/30 text-xl mt-1 font-minecraft">{t('friends.no_friends_desc')}</p>
      </div>
    );
  }

  return (
    <Virtuoso
      style={{ height: "100%" }}
      data={listItems}
      itemContent={(index, row) => {
        if (row.type === "header") {
          const isOnline = row.status === "online";
          return (
            <div className="flex items-center gap-2 px-4 py-3">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={isOnline ? {
                  backgroundColor: "#22c55e",
                  boxShadow: "0 0 8px rgba(34, 197, 94, 0.6)"
                } : {
                  backgroundColor: "#6b7280"
                }}
              />
              <span className={cn(
                "text-xs font-bold uppercase tracking-wider font-minecraft-ten",
                isOnline ? "text-white/70" : "text-white/40"
              )}>
                {isOnline ? t('friends.online') : t('friends.offline')} — {row.count}
              </span>
            </div>
          );
        }

        return (
          <div className="px-3 pb-2">
            <FriendListItem friend={row.friend} />
          </div>
        );
      }}
    />
  );
}

function RequestsTab({
  incomingRequests,
  outgoingRequests,
  accentColor,
}: {
  incomingRequests: ReturnType<typeof useFriendsStore.getState>["pendingRequests"];
  outgoingRequests: ReturnType<typeof useFriendsStore.getState>["pendingRequests"];
  accentColor: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="p-4 border-b border-white/10">
        <div className="text-xs font-medium text-white/40 mb-3 font-minecraft-ten uppercase tracking-wider">
          {t('friends.add_friend')}
        </div>
        <AddFriendInput />
      </div>

      {incomingRequests.length > 0 && (
        <div className="mt-2">
          <div
            className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider font-minecraft-ten flex items-center gap-2"
            style={{ color: "#22c55e" }}
          >
            <Icon icon="solar:inbox-in-bold" className="w-4 h-4" />
            {t('friends.incoming')} — {incomingRequests.length}
          </div>
          <div className="px-3 space-y-2 pb-4">
            {incomingRequests.map((r) => (
              <FriendRequestItem key={r.id} request={r} type="incoming" />
            ))}
          </div>
        </div>
      )}

      {outgoingRequests.length > 0 && (
        <div className="mt-3">
          <div
            className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider font-minecraft-ten flex items-center gap-2"
            style={{ color: "rgba(255, 255, 255, 0.5)" }}
          >
            <Icon icon="solar:inbox-out-bold" className="w-4 h-4" />
            {t('friends.pending')} — {outgoingRequests.length}
          </div>
          <div className="px-3 space-y-2 pb-4">
            {outgoingRequests.map((r) => (
              <FriendRequestItem key={r.id} request={r} type="outgoing" />
            ))}
          </div>
        </div>
      )}

      {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
        <div className="p-8 text-center">
          <div
            className="w-14 h-14 mx-auto mb-4 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${accentColor}15`, border: `1px solid ${accentColor}40` }}
          >
            <Icon icon="solar:letter-linear" className="w-7 h-7" style={{ color: accentColor }} />
          </div>
          <p className="text-white/50 text-xs font-minecraft-ten">{t('friends.no_requests_title')}</p>
          <p className="text-white/30 text-xl mt-1 font-minecraft">{t('friends.no_requests_desc')}</p>
        </div>
      )}
    </>
  );
}
