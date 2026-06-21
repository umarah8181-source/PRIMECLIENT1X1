import { useEffect, useRef, useState, useMemo, useCallback, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { useFriendsStore, FriendsFriendUser } from "../../store/friends-store";
import { useThemeStore } from "../../store/useThemeStore";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";
import { useChatStore } from "../../store/chat-store";
import { toast } from "react-hot-toast";

function getDateLabel(timestamp: number, t: (key: string) => string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (messageDate.getTime() === today.getTime()) {
    return t('chat.today');
  } else if (messageDate.getTime() === yesterday.getTime()) {
    return t('chat.yesterday');
  } else {
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: messageDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

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

interface ChatParticipant {
  userId: string;
  joinedAt: number;
  role?: string;
}

interface ChatInfo {
  _id: string;
  participants: ChatParticipant[];
  type?: string;
  name?: string;
  timestamp?: number;
}

interface ChatPanelProps {
  friend: FriendsFriendUser;
}

const MESSAGES_PER_PAGE = 5; // Backend pageSize

export function ChatPanel({ friend }: ChatPanelProps) {
  const { t } = useTranslation();
  const { accentColor } = useThemeStore();
  const { closeChat, currentUser } = useFriendsStore();
  const messages = useChatStore((state) => state.messages);
  const isLoading = useChatStore((state) => state.isLoading);
  const customAvatarUrl = friend.avatarUrl;
  const crafatarAvatar = useCrafatarAvatar({ uuid: friend.uuid, size: 20 });
  const avatarUrl = customAvatarUrl || crafatarAvatar;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const chatId = useMemo(() => {
    if (!currentUser) return "";
    const sortedIds = [currentUser.uuid, friend.uuid].sort();
    return `${sortedIds[0]}_${sortedIds[1]}`;
  }, [currentUser, friend.uuid]);

  useEffect(() => {
    let cancelled = false;
    const initChat = async () => {
      if (!currentUser || !chatId) return;

      useChatStore.getState().setActiveChat(
        { _id: chatId, participants: [] },
        friend
      );

      try {
        await useChatStore.getState().loadMessages(chatId);
        if (cancelled) return;
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
        });
      } catch (e) {
        console.error("Failed to load messages:", e);
      }
    };

    initChat();
    return () => {
      cancelled = true;
      useChatStore.getState().clearActiveChat();
    };
  }, [chatId, currentUser, friend]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async (content: string) => {
    if (!chatId) return;
    try {
      await useChatStore.getState().sendMessage(chatId, content);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  };

  const handleInviteToServer = async () => {
    if (currentUser?.server && chatId) {
      try {
        await useChatStore.getState().sendMessage(chatId, `__INVITE__:${currentUser.server}`);
        toast.success(`Sent server invite for ${currentUser.server}`);
      } catch (e) {
        console.error("Failed to send invite:", e);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        {/* Skeleton Header */}
        <div
          className="flex items-center justify-between px-3 py-2.5 shrink-0"
          style={{
            borderBottom: `1px solid ${accentColor.value}40`,
            background: `linear-gradient(90deg, ${accentColor.value}20, ${accentColor.value}10)`,
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-lg"
              style={{ backgroundColor: `${accentColor.value}30` }}
            />
            <div
              className="w-7 h-7 rounded-lg"
              style={{ backgroundColor: `${accentColor.value}20` }}
            />
            <div
              className="h-4 w-24 rounded"
              style={{ backgroundColor: `${accentColor.value}20` }}
            />
          </div>
        </div>

        {/* Skeleton Messages */}
        <div className="flex-1 overflow-hidden py-3">
          {[80, 65, 90, 70, 85].map((width, i) => (
            <div key={i} className="flex gap-3 px-3 py-1 mb-2">
              <div
                className="w-8 h-8 rounded-md shrink-0"
                style={{ backgroundColor: `${accentColor.value}15` }}
              />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 rounded"
                    style={{
                      backgroundColor: `${accentColor.value}20`,
                      width: `${width}px`,
                    }}
                  />
                  <div
                    className="h-2 w-12 rounded"
                    style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
                  />
                </div>
                <div
                  className="h-4 rounded"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.08)",
                    width: `${40 + width / 3}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Skeleton Input */}
        <div className="px-3 py-2 shrink-0">
          <div
            className="h-10 rounded-lg"
            style={{ backgroundColor: `${accentColor.value}10` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex items-center justify-between px-3 py-2.5 shrink-0"
        style={{
          borderBottom: `1px solid ${accentColor.value}40`,
          background: `linear-gradient(90deg, ${accentColor.value}20, ${accentColor.value}10)`,
        }}
      >
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={friend.username}
              className="w-7 h-7 rounded-lg"
              style={{ border: `2px solid ${accentColor.value}50` }}
            />
          ) : (
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${accentColor.value}30`,
                border: `2px solid ${accentColor.value}50`,
              }}
            >
              <Icon
                icon="solar:user-bold"
                className="w-4 h-4"
                style={{ color: accentColor.value }}
              />
            </div>
          )}
          <span className="text-sm font-medium text-white font-minecraft-ten truncate">
            {friend.username}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {currentUser?.server && (
            <button
              onClick={handleInviteToServer}
              className="p-1.5 rounded-lg transition-all duration-200 flex items-center gap-1 cursor-pointer"
              style={{
                backgroundColor: `${accentColor.value}20`,
                border: `1px solid ${accentColor.value}40`,
                color: accentColor.value,
              }}
              title="Invite Friend to your Server"
            >
              <Icon icon="solar:letter-opened-bold" className="w-4 h-4" />
              <span className="text-[10px] font-minecraft-ten">Invite</span>
            </button>
          )}
          <button
            onClick={closeChat}
            className="p-1.5 rounded-lg transition-all duration-200 cursor-pointer"
            style={{
              backgroundColor: `${accentColor.value}20`,
              color: accentColor.value,
            }}
          >
            <Icon icon="solar:close-circle-bold" className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto py-3 custom-scrollbar flex flex-col"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
              style={{
                backgroundColor: `${accentColor.value}15`,
                border: `1px solid ${accentColor.value}40`,
              }}
            >
              <Icon
                icon="solar:chat-round-line-linear"
                className="w-6 h-6"
                style={{ color: accentColor.value }}
              />
            </div>
            <p className="text-white/50 text-xs font-minecraft-ten">{t('chat.no_messages_title')}</p>
            <p className="text-white/30 text-xl mt-1 font-minecraft">{t('chat.no_messages_desc')}</p>
          </div>
        ) : (
          <>
            {/* Spacer to push content to bottom */}
            <div className="flex-1" />
            {messages.filter((m) => m != null).map((message, index, arr) => {
              const timestamp = message.createdAt || message.sentAt || message.timestamp || 0;
              const prevMessage = arr[index - 1];
              const prevTimestamp = prevMessage ? (prevMessage.createdAt || prevMessage.sentAt || prevMessage.timestamp || 0) : 0;

              const showDateSeparator = index === 0 ||
                getDateLabel(timestamp, t) !== getDateLabel(prevTimestamp, t);

              // Discord-style: show header if different sender or > 5 min gap
              const isNewGroup = !prevMessage ||
                prevMessage.senderId !== message.senderId ||
                (timestamp - prevTimestamp) > 5 * 60 * 1000 ||
                showDateSeparator;

              return (
                <div key={message._id} data-message-id={message._id}>
                  {showDateSeparator && (
                    <div className="flex items-center justify-center py-3 my-1">
                      <div
                        className="px-3 py-1 rounded-full text-[10px] font-minecraft-ten uppercase tracking-wider"
                        style={{
                          backgroundColor: `${accentColor.value}15`,
                          color: `${accentColor.value}90`,
                          border: `1px solid ${accentColor.value}30`,
                        }}
                      >
                        {getDateLabel(timestamp, t)}
                      </div>
                    </div>
                  )}
                  <ChatMessage
                    message={message}
                    isOwn={message.senderId === currentUser?.uuid}
                    friendUuid={friend.uuid}
                    friendName={friend.username}
                    currentUserUuid={currentUser?.uuid}
                    currentUserName={currentUser?.username}
                    accentColor={accentColor.value}
                    showHeader={isNewGroup}
                    customAvatarUrl={message.senderId === currentUser?.uuid ? currentUser?.avatarUrl : friend.avatarUrl}
                  />
                </div>
              );
            })}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={handleSend}
        accentColor={accentColor.value}
      />
    </div>
  );
}
