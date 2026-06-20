import { create } from 'zustand';
import { useMinecraftAuthStore } from './minecraft-auth-store';
import { useFriendsStore } from './friends-store';

export interface ChatParticipant {
  userId: string;
  joinedAt: number;
  role?: string;
}

export interface Chat {
  _id: string;
  participants: ChatParticipant[];
  type?: string;
  name?: string;
  timestamp?: number;
  groupAvatarUrl?: string;
  unreadMessages?: number;
  latestMessage?: ChatMessage;
}

export interface ChatMessageReaction {
  emoji: string;
  reactor: string;
}

export interface ChatMessage {
  _id: string;
  chatId: string;
  senderId: string;
  content: string;
  relatesTo?: string;
  createdAt?: number;
  sentAt?: number;
  receivedAt?: number;
  readAt?: number;
  editedAt?: number;
  deletedAt?: number;
  reactions: ChatMessageReaction[];
  timestamp?: number;
}

export interface ComputedChat {
  _id: string;
  participants: ChatParticipant[];
  type?: string;
  name?: string;
  timestamp?: number;
  groupAvatarUrl?: string;
  unreadMessages: number;
  latestMessage?: ChatMessage;
}

interface ChatState {
  activeChat: Chat | null;
  activeFriend: { uuid: string; username: string } | null;
  messages: ChatMessage[];
  chats: ComputedChat[];
  isLoading: boolean;
  typingUsers: Set<string>;
  error: string | null;

  setActiveChat: (chat: Chat, friend: { uuid: string; username: string }) => void;
  clearActiveChat: () => void;

  loadChats: () => Promise<void>;
  loadMessages: (chatId: string, page?: number) => Promise<void>;
  sendMessage: (chatId: string, content: string, relatesTo?: string) => Promise<ChatMessage>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;

  sendTypingIndicator: (chatId: string) => Promise<void>;
  addTypingUser: (chatId: string, uuid: string) => void;
  removeTypingUser: (chatId: string, uuid: string) => void;

  addMessage: (message: ChatMessage) => void;
  updateMessage: (message: ChatMessage) => void;
  removeMessage: (messageId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeChat: null,
  activeFriend: null,
  messages: [],
  chats: [],
  isLoading: false,
  typingUsers: new Set(),
  error: null,

  setActiveChat: (chat, friend) => {
    set({ activeChat: chat, activeFriend: friend, messages: [] });
  },

  clearActiveChat: () => {
    set({ activeChat: null, activeFriend: null, messages: [], typingUsers: new Set() });
  },

  loadChats: async () => {
    try {
      const friends = useFriendsStore.getState().friends;
      const activeAccount = useMinecraftAuthStore.getState().activeAccount;
      if (!activeAccount) return;
      const myUuid = activeAccount.id;

      const chatsDetails = await Promise.all(
        friends.map(async (friend) => {
          const sortedIds = [myUuid, friend.uuid].sort();
          const chatId = `${sortedIds[0]}_${sortedIds[1]}`;
          
          const chatRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/chats/${chatId}.json`);
          const chatData = await chatRes.json();
          
          const lastReadTimes = JSON.parse(localStorage.getItem('chat_last_read_times') || '{}');
          const latestMessage = chatData?.latestMessage;
          const unreadMessages = (latestMessage && latestMessage.senderId !== myUuid && (!lastReadTimes[chatId] || latestMessage.timestamp > lastReadTimes[chatId])) ? 1 : 0;

          return {
            _id: chatId,
            participants: [
              { userId: myUuid, joinedAt: Date.now() },
              { userId: friend.uuid, joinedAt: Date.now() }
            ],
            latestMessage,
            unreadMessages,
            timestamp: chatData?.timestamp || Date.now()
          } as ComputedChat;
        })
      );

      const chats = chatsDetails.sort((a, b) => b.timestamp - a.timestamp);
      set({ chats });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadMessages: async (chatId: string, page: number = 0) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/messages/${chatId}.json`);
      const data = await res.json();
      let messagesList: ChatMessage[] = [];
      if (data) {
        messagesList = Object.keys(data).map(key => ({
          _id: key,
          chatId: data[key].chatId || chatId,
          senderId: data[key].senderId,
          content: data[key].content,
          timestamp: data[key].timestamp,
          reactions: data[key].reactions || []
        }));
        messagesList.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      }
      
      const lastReadTimes = JSON.parse(localStorage.getItem('chat_last_read_times') || '{}');
      if (messagesList.length > 0) {
        lastReadTimes[chatId] = messagesList[messagesList.length - 1].timestamp;
        localStorage.setItem('chat_last_read_times', JSON.stringify(lastReadTimes));
      }

      set({ messages: messagesList, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  sendMessage: async (chatId: string, content: string, relatesTo?: string) => {
    try {
      const activeAccount = useMinecraftAuthStore.getState().activeAccount;
      if (!activeAccount) throw new Error("No active account");
      const senderId = activeAccount.id;
      
      const messageId = crypto.randomUUID();
      const message: ChatMessage = {
        _id: messageId,
        chatId,
        senderId,
        content,
        timestamp: Date.now(),
        reactions: []
      };

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/messages/${chatId}/${messageId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });

      const chatUpdate = {
        id: chatId,
        latestMessage: message,
        timestamp: Date.now()
      };
      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/chats/${chatId}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatUpdate)
      });

      set((s) => ({ messages: [...s.messages, message] }));
      return message;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  editMessage: async (messageId: string, content: string) => {
    try {
      const { activeChat } = get();
      if (!activeChat) return;
      const chatId = activeChat._id;

      const res = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/messages/${chatId}/${messageId}.json`);
      const existing = await res.json();
      if (!existing) return;

      const updated = { ...existing, content, editedAt: Date.now() };

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/messages/${chatId}/${messageId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });

      const chatRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/chats/${chatId}.json`);
      const chatData = await chatRes.json();
      if (chatData?.latestMessage?._id === messageId) {
        await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/chats/${chatId}/latestMessage/content.json`, {
          method: 'PUT',
          body: JSON.stringify(content)
        });
      }

      set((s) => ({
        messages: s.messages.map((m) => (m._id === messageId ? { ...m, content, editedAt: updated.editedAt } : m)),
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteMessage: async (messageId: string) => {
    try {
      const { activeChat } = get();
      if (!activeChat) return;
      const chatId = activeChat._id;

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/messages/${chatId}/${messageId}.json`, {
        method: 'DELETE'
      });

      const chatRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/chats/${chatId}.json`);
      const chatData = await chatRes.json();
      if (chatData?.latestMessage?._id === messageId) {
        await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/chats/${chatId}/latestMessage.json`, {
          method: 'DELETE'
        });
      }

      set((s) => ({
        messages: s.messages.filter((m) => m._id !== messageId),
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  sendTypingIndicator: async (chatId: string) => {
    try {
      const activeAccount = useMinecraftAuthStore.getState().activeAccount;
      if (!activeAccount) return;
      const myUuid = activeAccount.id;

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/chats/${chatId}/typing/${myUuid}.json`, {
        method: 'PUT',
        body: JSON.stringify(Date.now())
      });

      setTimeout(async () => {
        await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/chats/${chatId}/typing/${myUuid}.json`, {
          method: 'DELETE'
        });
      }, 3000);
    } catch (e) {
      console.error('Failed to send typing indicator:', e);
    }
  },

  addTypingUser: (chatId: string, uuid: string) => {
    const { activeChat } = get();
    if (activeChat?._id === chatId) {
      set((s) => ({
        typingUsers: new Set([...s.typingUsers, uuid]),
      }));
    }
  },

  removeTypingUser: (chatId: string, uuid: string) => {
    const { activeChat } = get();
    if (activeChat?._id === chatId) {
      set((s) => {
        const newSet = new Set(s.typingUsers);
        newSet.delete(uuid);
        return { typingUsers: newSet };
      });
    }
  },

  addMessage: (message: ChatMessage) => {
    const { activeChat } = get();
    if (activeChat?._id === message.chatId) {
      set((s) => ({ messages: [...s.messages, message] }));
    }
  },

  updateMessage: (message: ChatMessage) => {
    set((s) => ({
      messages: s.messages.map((m) => (m._id === message._id ? message : m)),
    }));
  },

  removeMessage: (messageId: string) => {
    set((s) => ({
      messages: s.messages.filter((m) => m._id !== messageId),
    }));
  },
}));
