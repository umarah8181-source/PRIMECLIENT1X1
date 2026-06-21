import { Icon } from "@iconify/react";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";
import { useProfileStore } from "../../store/profile-store";
import { useProfileLaunch } from "../../hooks/useProfileLaunch";
import { useFriendsStore } from "../../store/friends-store";
import { toast } from "react-hot-toast";

interface MessageReaction {
  emoji: string;
  reactor: string;
}

interface Message {
  _id: string;
  chatId: string;
  senderId: string;
  content: string;
  createdAt?: number;
  sentAt?: number;
  receivedAt?: number;
  readAt?: number;
  editedAt?: number;
  deletedAt?: number;
  reactions: MessageReaction[];
  relatesTo?: string;
  timestamp?: number;
}

interface ChatMessageProps {
  message: Message;
  isOwn: boolean;
  friendUuid: string;
  friendName: string;
  currentUserUuid?: string;
  currentUserName?: string;
  accentColor: string;
  showHeader: boolean;
  customAvatarUrl?: string | null;
}

export function ChatMessage({ message, isOwn, friendUuid, friendName, currentUserUuid, currentUserName, accentColor, showHeader, customAvatarUrl }: ChatMessageProps) {
  const avatarUuid = isOwn ? currentUserUuid : friendUuid;
  const crafatarAvatar = useCrafatarAvatar({ uuid: avatarUuid, size: 32 });
  const avatarUrl = customAvatarUrl || crafatarAvatar;

  const isInvite = message.content.startsWith("__INVITE__:");
  const inviteServer = isInvite ? message.content.substring(11) : "";

  const { selectedProfile, profiles } = useProfileStore();
  const activeProfile = selectedProfile || profiles[0];

  const { handleQuickPlayLaunch, isLaunching } = useProfileLaunch({
    profileId: activeProfile?.id || "",
    onLaunchSuccess: () => {
      if (inviteServer) {
        useFriendsStore.getState().setLaunchedServer(inviteServer);
      }
    }
  });

  const handleJoinServer = () => {
    if (!inviteServer) return;
    if (!activeProfile) {
      toast.error("No Minecraft profiles found. Please create one first.");
      return;
    }
    toast.success(`Joining server ${inviteServer}...`);
    useFriendsStore.getState().setLaunchedServer(inviteServer);
    handleQuickPlayLaunch(undefined, inviteServer);
  };

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const timestamp = message.createdAt || message.sentAt || message.timestamp;
  const displayName = isOwn ? (currentUserName || "You") : friendName;

  return (
    <div className="flex gap-3 px-3 py-1 hover:bg-white/5 transition-colors group">
      {/* Avatar or hover timestamp */}
      <div className="w-8 flex-shrink-0 flex items-start justify-center pt-0.5">
        {showHeader ? (
          avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="w-8 h-8 rounded-md"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-md flex items-center justify-center"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <Icon icon="solar:user-bold" className="w-4 h-4" style={{ color: accentColor }} />
            </div>
          )
        ) : (
          <span className="text-[10px] text-white/30 opacity-0 group-hover:opacity-100 transition-opacity font-minecraft-ten">
            {formatTime(timestamp)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {showHeader && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span
              className="font-minecraft-ten text-sm"
              style={{ color: isOwn ? accentColor : "#ffffff" }}
            >
              {displayName}
            </span>
            <span className="text-[11px] text-white/40 font-minecraft-ten">
              {formatTime(timestamp)}
            </span>
          </div>
        )}
        {isInvite ? (
          <div
            className="mt-1 p-3 rounded-lg border max-w-sm flex flex-col gap-2.5 transition-all duration-200"
            style={{
              backgroundColor: `${accentColor}10`,
              borderColor: `${accentColor}40`,
            }}
          >
            <div className="flex items-center gap-2">
              <Icon icon="solar:letter-opened-bold" className="w-5 h-5" style={{ color: accentColor }} />
              <span className="font-minecraft-ten text-xs text-white/90 uppercase tracking-wider">
                Server Invitation
              </span>
            </div>
            
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-white/40 font-minecraft">
                {isOwn ? "You invited this friend to join:" : `${friendName} invited you to join:`}
              </span>
              <span className="text-sm font-minecraft-ten text-white font-semibold select-all">
                {inviteServer}
              </span>
            </div>

            <button
              onClick={handleJoinServer}
              disabled={isLaunching}
              className="mt-1 w-full py-1.5 px-3 rounded text-xs font-minecraft-ten transition-all duration-200 hover:scale-[1.02] flex items-center justify-center gap-1.5 cursor-pointer text-white"
              style={{
                backgroundColor: accentColor,
                boxShadow: `0 0 8px ${accentColor}40`,
              }}
            >
              {isLaunching ? (
                <>
                  <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
                  <span>Launching...</span>
                </>
              ) : (
                <>
                  <Icon icon="solar:gamepad-bold" className="w-4 h-4" />
                  <span>Join Server</span>
                </>
              )}
            </button>
          </div>
        ) : (
          <p className="text-sm text-white/90 whitespace-pre-wrap break-words font-minecraft-ten leading-relaxed">
            {message.content}
          </p>
        )}
      </div>
    </div>
  );
}
