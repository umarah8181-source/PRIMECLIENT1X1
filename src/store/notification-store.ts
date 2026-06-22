import { create } from "zustand";
import type { UserNotification } from "../types/notification";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../services/nrc-service";

interface NotificationStoreState {
  notifications: UserNotification[];
  isModalOpen: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  setNotifications: (notifications: UserNotification[]) => void;
  fetchNotifications: () => Promise<void>;
  markAllAsRead: () => Promise<void>;
    markAsRead: (notificationId: string) => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => ({
  notifications: [],
  isModalOpen: false,
  isLoading: false,
  error: null,

  setNotifications: (notifications) => set({ notifications }),

  fetchNotifications: async () => {
    set({ isLoading: true, error: null });
    try {
      let backendNotifications: UserNotification[] = [];
      try {
        backendNotifications = await getNotifications();
      } catch (err) {
        console.warn("[NotificationStore] Failed to fetch backend notifications:", err);
      }
      let globalNotifications: UserNotification[] = [];
      try {
        const res = await fetch("https://primeclient.is-best.net/notifications.json");
        if (res.ok) {
          const data = await res.json();
          if (data) {
            const seenList: string[] = JSON.parse(localStorage.getItem("seen-global-notifications") || "[]");
            globalNotifications = Object.entries(data)
              .filter(([_, val]) => val !== null && typeof val === "object")
              .map(([id, val]: [string, any]) => {
                const title = val.title || "";
                const message = val.message || "";
                return {
                  _id: `global-${id}`,
                  userId: "global",
                  seen: seenList.includes(id),
                  notification: {
                    type: "gg.prime.networking.model.notifications.notification.SimpleTextNotification",
                    createdAt: val.createdAt || new Date().toISOString(),
                    message: `${title}: ${message}`,
                  },
                  deletionDate: null,
                } as UserNotification;
              });
          }
        }
      } catch (err) {
        console.error("[NotificationStore] Failed to fetch global notifications from Firebase:", err);
      }

      const merged = [...backendNotifications, ...globalNotifications];
      // Sort by createdAt descending (newest first)
      const sorted = merged.sort((a, b) => {
        const dateA = a.notification.createdAt ? new Date(a.notification.createdAt).getTime() : 0;
        const dateB = b.notification.createdAt ? new Date(b.notification.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      set({ notifications: sorted, isLoading: false });
    } catch (error) {
      console.error("[NotificationStore] Failed to fetch notifications:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to fetch notifications",
        isLoading: false,
      });
    }
  },

  markAllAsRead: async () => {
    try {
      const unreadGlobals = get().notifications.filter(n => n._id.startsWith("global-") && !n.seen);
      if (unreadGlobals.length > 0) {
        const seenList: string[] = JSON.parse(localStorage.getItem("seen-global-notifications") || "[]");
        unreadGlobals.forEach(n => {
          const id = n._id.substring(7);
          if (!seenList.includes(id)) {
            seenList.push(id);
          }
        });
        localStorage.setItem("seen-global-notifications", JSON.stringify(seenList));
      }

      const unreadBackends = get().notifications.filter(n => !n._id.startsWith("global-") && !n.seen);
      if (unreadBackends.length > 0) {
        await markAllNotificationsRead();
      }

      // Update local state to mark all as seen
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, seen: true })),
      }));
    } catch (error) {
      console.error("[NotificationStore] Failed to mark notifications as read:", error);
    }
  },

  markAsRead: async (notificationId: string) => {
    try {
      if (notificationId.startsWith("global-")) {
        const id = notificationId.substring(7);
        const seenList: string[] = JSON.parse(localStorage.getItem("seen-global-notifications") || "[]");
        if (!seenList.includes(id)) {
          seenList.push(id);
          localStorage.setItem("seen-global-notifications", JSON.stringify(seenList));
        }
      } else {
        await markNotificationRead(notificationId);
      }
      // Update local state to mark the specific notification as seen
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n._id === notificationId ? { ...n, seen: true } : n
        ),
      }));
    } catch (error) {
      console.error(`[NotificationStore] Failed to mark notification ${notificationId} as read:`, error);
    }
  },

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),
}));

// Selector for unread count
export const useUnreadCount = () =>
  useNotificationStore((state) => state.notifications.filter((n) => !n.seen).length);
