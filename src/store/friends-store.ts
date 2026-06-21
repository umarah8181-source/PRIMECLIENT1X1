import { create } from 'zustand';
import { useProcessStore } from './useProcessStore';
import { useChatStore, ChatMessage } from './chat-store';
import { toast } from '../components/ui/GlobalToaster';
import i18n from '../i18n/i18n';
import { useMinecraftAuthStore } from './minecraft-auth-store';

export type OnlineState = 'ONLINE' | 'OFFLINE' | 'AFK' | 'BUSY' | 'INVISIBLE';

export interface FriendsFriendUser {
  uuid: string;
  username: string;
  state: OnlineState;
  server: string | null;
  pingEnabled: boolean | null;
  avatarUrl?: string | null;
}

export interface FriendsUser {
  uuid: string;
  username: string;
  state: OnlineState;
  server: string | null;
  privacy: {
    showServer: boolean;
    allowRequests: boolean;
    allowServerInvites: boolean;
  };
  avatarUrl?: string | null;
}

export interface FriendRequestUser {
  uuid: string;
  username: string;
  avatarUrl?: string | null;
}

export interface FriendRequestWithUsers {
  id: string;
  sender: string;
  receiver: string;
  state: 'PENDING' | 'ACCEPTED' | 'DENIED' | 'WITHDRAWN' | 'NONE';
  timestamp: number;
  users: FriendRequestUser[];
}

interface FriendsState {
  friends: FriendsFriendUser[];
  pendingRequests: FriendRequestWithUsers[];
  currentUser: FriendsUser | null;
  isLoading: boolean;
  isSidebarOpen: boolean;
  isSettingsOpen: boolean;
  wsConnected: boolean;
  notificationsEnabled: boolean;
  error: string | null;
  activeChatFriend: FriendsFriendUser | null;
  lastFetchedAt: number | null;
  intervalId: number | null;
  launchedServer: string | null;
  friendsAccount: { uuid: string; username: string } | null;

  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;

  loadFriends: (force?: boolean) => Promise<void>;
  loadPendingRequests: () => Promise<void>;
  loadCurrentUser: () => Promise<void>;

  sendRequest: (name: string) => Promise<void>;
  acceptRequest: (name: string) => Promise<void>;
  denyRequest: (name: string) => Promise<void>;
  removeFriend: (name: string, uuid: string) => Promise<void>;

  setStatus: (state: OnlineState) => Promise<void>;
  togglePing: (friendName: string) => Promise<boolean>;

  connectWebSocket: () => Promise<void>;
  disconnectWebSocket: () => Promise<void>;

  updateFriendStatus: (uuid: string, state: OnlineState) => void;
  updateFriendServer: (uuid: string, server: string | null) => void;
  updateFriendState: (uuid: string, state: OnlineState, server?: string) => void;
  addFriend: (friend: FriendsFriendUser) => void;
  removeFriendFromList: (uuid: string) => void;
  removeFriendByUuid: (uuid: string) => void;
  setWsConnected: (connected: boolean) => void;
  addPendingRequest: (request: FriendRequestWithUsers) => void;
  removePendingRequest: (id: string) => void;
  openChat: (friend: FriendsFriendUser) => void;
  closeChat: () => void;
  toggleNotifications: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  updatePrivacySetting: (setting: string, value: boolean) => Promise<void>;
  setLaunchedServer: (server: string | null) => void;

  loginFriendsAccount: (username: string, password: string) => Promise<void>;
  registerFriendsAccount: (username: string, password: string) => Promise<void>;
  logoutFriendsAccount: () => Promise<void>;
  updateFriendsProfile: (newAvatarUrl: string) => Promise<void>;
  syncWithMinecraftAccount: (minecraftAccount: any | null) => Promise<void>;
  ranks: Record<string, string>;
  loadRanks: () => Promise<void>;
}

// Load account from localStorage if exists
let initialFriendsAccount: { uuid: string; username: string } | null = null;
try {
  const activeMc = useMinecraftAuthStore.getState().activeAccount;
  if (activeMc) {
    const saved = localStorage.getItem(`prime_friends_account_${activeMc.id}`);
    if (saved) {
      initialFriendsAccount = JSON.parse(saved);
    }
  } else {
    const saved = localStorage.getItem('prime_friends_account');
    if (saved) {
      initialFriendsAccount = JSON.parse(saved);
    }
  }
} catch (e) {
  console.error("Failed to parse initial friends account:", e);
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  pendingRequests: [],
  currentUser: null,
  isLoading: false,
  isSidebarOpen: false,
  isSettingsOpen: false,
  wsConnected: false,
  notificationsEnabled: true,
  error: null,
  activeChatFriend: null,
  lastFetchedAt: null,
  intervalId: null,
  launchedServer: null,
  friendsAccount: initialFriendsAccount,
  ranks: {},

  loadRanks: async () => {
    try {
      const res = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/ranks.json`);
      const data = await res.json();
      set({ ranks: data || {} });
    } catch (e) {
      console.error("Failed to load ranks:", e);
    }
  },

  openSidebar: () => set({ isSidebarOpen: true }),
  closeSidebar: () => set({ isSidebarOpen: false }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  setLaunchedServer: (server) => set({ launchedServer: server }),

  loginFriendsAccount: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const usernameLower = username.trim().toLowerCase();
      const res = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendsAccounts/${usernameLower}.json`);
      const data = await res.json();
      
      if (!data) {
        throw new Error("Username not found");
      }
      if (data.password !== password) {
        throw new Error("Incorrect password");
      }

      const uuid = data.uuid;
      const account = { uuid, username: data.username };
      
      const mcAccount = useMinecraftAuthStore.getState().activeAccount;
      if (mcAccount) {
        localStorage.setItem(`prime_friends_account_${mcAccount.id}`, JSON.stringify(account));
      }
      localStorage.setItem('prime_friends_account', JSON.stringify(account));

      set({ friendsAccount: account, isLoading: false });
      
      await get().loadCurrentUser();
      await get().setStatus('ONLINE');
      await get().connectWebSocket();
    } catch (e: any) {
      set({ error: e.message || String(e), isLoading: false });
      throw e;
    }
  },

  registerFriendsAccount: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const usernameClean = username.trim();
      const usernameLower = usernameClean.toLowerCase();
      
      if (usernameClean.length < 3 || usernameClean.length > 16) {
        throw new Error("Username must be between 3 and 16 characters");
      }
      if (password.length < 3) {
        throw new Error("Password must be at least 3 characters");
      }

      // Check if exists
      const res = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendsAccounts/${usernameLower}.json`);
      const data = await res.json();
      if (data) {
        throw new Error("Username is already taken");
      }

      const uuid = crypto.randomUUID();
      
      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendsAccounts/${usernameLower}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: usernameClean,
          password: password,
          uuid: uuid
        })
      });

      const userData = {
        username: usernameClean,
        state: 'ONLINE',
        server: null,
        lastActive: Date.now(),
        privacy: {
          showServer: true,
          allowRequests: true,
          allowServerInvites: true
        }
      };
      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${uuid}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });

      const account = { uuid, username: usernameClean };
      
      const mcAccount = useMinecraftAuthStore.getState().activeAccount;
      if (mcAccount) {
        localStorage.setItem(`prime_friends_account_${mcAccount.id}`, JSON.stringify(account));
      }
      localStorage.setItem('prime_friends_account', JSON.stringify(account));

      set({ friendsAccount: account, isLoading: false });
      
      await get().loadCurrentUser();
      await get().connectWebSocket();
    } catch (e: any) {
      set({ error: e.message || String(e), isLoading: false });
      throw e;
    }
  },

  logoutFriendsAccount: async () => {
    const account = get().friendsAccount;
    if (account) {
      try {
        await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${account.uuid}/state.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify('OFFLINE')
        });
        await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${account.uuid}/lastActive.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(0)
        });
      } catch (e) {
        console.error("Failed to set status OFFLINE on logout:", e);
      }
    }

    await get().disconnectWebSocket();

    const mcAccount = useMinecraftAuthStore.getState().activeAccount;
    if (mcAccount) {
      localStorage.removeItem(`prime_friends_account_${mcAccount.id}`);
    }
    localStorage.removeItem('prime_friends_account');

    set({
      friendsAccount: null,
      currentUser: null,
      friends: [],
      pendingRequests: [],
      activeChatFriend: null
    });
  },

  loadFriends: async (force = false) => {
    const state = get();
    const now = Date.now();
    const staleTime = 30_000;

    if (!force && state.friends.length > 0 && state.lastFetchedAt && (now - state.lastFetchedAt) < staleTime) {
      return;
    }

    set({ isLoading: true, error: null });
    try {
      await get().loadRanks();
      const account = get().friendsAccount;
      if (!account) {
        set({ isLoading: false });
        return;
      }
      const myUuid = account.uuid;

      const friendsRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friends/${myUuid}.json`);
      const friendsData = await friendsRes.json();
      
      let friendsList: FriendsFriendUser[] = [];
      if (friendsData) {
        const friendUuids = Object.keys(friendsData);
        const friendsDetails = await Promise.all(
          friendUuids.map(async (fUuid) => {
            try {
              const userRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${fUuid}.json`);
              const userData = await userRes.json();
              if (userData) {
                const pingEnabled = friendsData[fUuid]?.pingEnabled || false;
                const isOffline = !userData.lastActive || (Date.now() - userData.lastActive > 45000) || userData.state === 'INVISIBLE';
                const onlineState: OnlineState = isOffline ? 'OFFLINE' : userData.state;
                const serverAddress = isOffline ? null : userData.server;

                return {
                  uuid: fUuid,
                  username: userData.username || 'Unknown',
                  state: onlineState,
                  server: serverAddress,
                  pingEnabled,
                  avatarUrl: userData.avatarUrl || null
                } as FriendsFriendUser;
              }
            } catch (e) {
              console.error("Failed to load details for friend uuid:", fUuid, e);
            }
            return null;
          })
        );
        friendsList = friendsDetails.filter((f): f is FriendsFriendUser => f !== null);
      }
      set({ friends: friendsList, isLoading: false, lastFetchedAt: now });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  loadPendingRequests: async () => {
    try {
      const account = get().friendsAccount;
      if (!account) return;
      const myUuid = account.uuid;

      const reqsRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendRequests/${myUuid}.json`);
      const reqsData = await reqsRes.json();
      let requestsList: FriendRequestWithUsers[] = [];
      if (reqsData) {
        const keys = Object.keys(reqsData);
        requestsList = await Promise.all(keys.map(async (key) => {
          const req = reqsData[key];
          try {
            const senderRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${req.senderUuid}.json`);
            const senderData = await senderRes.json();
            const receiverRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.map/users/${req.receiverUuid}.json`);
            const receiverData = await receiverRes.json();
            return {
              id: req.id || key,
              sender: req.senderUuid,
              receiver: req.receiverUuid,
              state: req.state || 'PENDING',
              timestamp: req.timestamp || Date.now(),
              users: [
                { 
                  uuid: req.senderUuid, 
                  username: senderData?.username || req.senderUsername,
                  avatarUrl: senderData?.avatarUrl || null
                },
                { 
                  uuid: req.receiverUuid, 
                  username: receiverData?.username || req.receiverUsername,
                  avatarUrl: receiverData?.avatarUrl || null
                }
              ]
            };
          } catch (err) {
            console.error("Failed to load details for request:", key, err);
            return {
              id: req.id || key,
              sender: req.senderUuid,
              receiver: req.receiverUuid,
              state: req.state || 'PENDING',
              timestamp: req.timestamp || Date.now(),
              users: [
                { uuid: req.senderUuid, username: req.senderUsername, avatarUrl: null },
                { uuid: req.receiverUuid, username: req.receiverUsername, avatarUrl: null }
              ]
            };
          }
        }));
      }
      set({ pendingRequests: requestsList });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadCurrentUser: async () => {
    try {
      await get().loadRanks();
      const account = get().friendsAccount;
      if (!account) return;
      const myUuid = account.uuid;

      const res = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${myUuid}.json`);
      let userData = await res.json();

      if (!userData) {
        userData = {
          username: account.username,
          state: 'ONLINE',
          server: null,
          lastActive: Date.now(),
          privacy: {
            showServer: true,
            allowRequests: true,
            allowServerInvites: true
          }
        };
        await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${myUuid}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userData)
        });
      }

      set({
        currentUser: {
          uuid: myUuid,
          username: userData.username || account.username,
          state: userData.state || 'ONLINE',
          server: userData.server || null,
          privacy: userData.privacy || {
            showServer: true,
            allowRequests: true,
            allowServerInvites: true
          },
          avatarUrl: userData.avatarUrl || null
        }
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  sendRequest: async (name: string) => {
    try {
      const account = get().friendsAccount;
      if (!account) throw new Error("Not logged into friends account");
      const myUuid = account.uuid;
      const myUsername = account.username;

      const nameLower = name.trim().toLowerCase();
      const res = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendsAccounts/${nameLower}.json`);
      const targetData = await res.json();
      if (!targetData) {
        throw new Error("User '" + name + "' not found on the friends network");
      }

      const targetUuid = targetData.uuid;
      const targetUsername = targetData.username;

      if (targetUuid === myUuid) {
        throw new Error("You cannot add yourself as a friend");
      }

      const requestObj = {
        id: targetUuid,
        senderUuid: myUuid,
        senderUsername: myUsername,
        receiverUuid: targetUuid,
        receiverUsername: targetUsername,
        state: 'PENDING',
        timestamp: Date.now()
      };

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendRequests/${targetUuid}/${myUuid}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestObj, id: myUuid })
      });

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendRequests/${myUuid}/${targetUuid}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestObj)
      });

      await get().loadPendingRequests();
    } catch (e: any) {
      set({ error: e.message || String(e) });
      throw e;
    }
  },

  acceptRequest: async (name: string) => {
    try {
      const account = get().friendsAccount;
      if (!account) throw new Error("Not logged into friends account");
      const myUuid = account.uuid;

      const request = get().pendingRequests.find(r => 
        r.users.some(u => u.username.toLowerCase() === name.toLowerCase())
      );
      if (!request) throw new Error("No pending request found for user " + name);

      const friendUuid = request.sender === myUuid ? request.receiver : request.sender;

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendRequests/${myUuid}/${friendUuid}.json`, { method: 'DELETE' });
      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendRequests/${friendUuid}/${myUuid}.json`, { method: 'DELETE' });

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friends/${myUuid}/${friendUuid}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true, pingEnabled: false })
      });
      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friends/${friendUuid}/${myUuid}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true, pingEnabled: false })
      });

      set((state) => ({
        pendingRequests: state.pendingRequests.filter(
          (r) => !r.users.some((u) => u.username === name)
        ),
      }));

      await get().loadFriends(true);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  denyRequest: async (name: string) => {
    try {
      const account = get().friendsAccount;
      if (!account) throw new Error("Not logged into friends account");
      const myUuid = account.uuid;

      const request = get().pendingRequests.find(r => 
        r.users.some(u => u.username.toLowerCase() === name.toLowerCase())
      );
      if (!request) throw new Error("No pending request found for user " + name);

      const friendUuid = request.sender === myUuid ? request.receiver : request.sender;

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendRequests/${myUuid}/${friendUuid}.json`, { method: 'DELETE' });
      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendRequests/${friendUuid}/${myUuid}.json`, { method: 'DELETE' });

      set((state) => ({
        pendingRequests: state.pendingRequests.filter(
          (r) => !r.users.some((u) => u.username === name)
        ),
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  removeFriend: async (name: string, uuid: string) => {
    try {
      const account = get().friendsAccount;
      if (!account) throw new Error("Not logged into friends account");
      const myUuid = account.uuid;

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friends/${myUuid}/${uuid}.json`, { method: 'DELETE' });
      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friends/${uuid}/${myUuid}.json`, { method: 'DELETE' });

      set((state) => ({
        friends: state.friends.filter((f) => f.uuid !== uuid),
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  setStatus: async (status: OnlineState) => {
    try {
      const account = get().friendsAccount;
      if (!account) throw new Error("Not logged into friends account");
      const myUuid = account.uuid;

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${myUuid}/state.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(status)
      });

      set((state) => ({
        currentUser: state.currentUser
          ? { ...state.currentUser, state: status }
          : null,
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  togglePing: async (friendName: string) => {
    try {
      const account = get().friendsAccount;
      if (!account) throw new Error("Not logged into friends account");
      const myUuid = account.uuid;

      const friend = get().friends.find(f => f.username === friendName);
      if (!friend) return false;
      const nextVal = !friend.pingEnabled;

      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friends/${myUuid}/${friend.uuid}/pingEnabled.json`, {
        method: 'PUT',
        body: JSON.stringify(nextVal)
      });

      set((state) => ({
        friends: state.friends.map((f) =>
          f.username === friendName ? { ...f, pingEnabled: nextVal } : f
        ),
      }));
      return nextVal;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  connectWebSocket: async () => {
    const existing = get().intervalId;
    if (existing) {
      clearInterval(existing);
    }

    set({ wsConnected: true });

    let loopCount = 0;
    const previousStates: Record<string, OnlineState> = {};
    let previousRequestsCount = -1;
    const lastNotifiedMessageTimestamps: Record<string, number> = {};

    const syncLoop = async () => {
      try {
        const account = get().friendsAccount;
        if (!account) return;

        const myUuid = account.uuid;
        const myUsername = account.username;

        const processes = useProcessStore.getState().processes;
        if (processes.length === 0 && get().launchedServer !== null) {
          set({ launchedServer: null });
        }

        const currentLaunchedServer = get().launchedServer;
        const currentUserState = get().currentUser;
        let currentState = currentUserState?.state || 'ONLINE';
        if (currentState === 'OFFLINE') {
          currentState = 'ONLINE';
          set((state) => ({
            currentUser: state.currentUser ? { ...state.currentUser, state: 'ONLINE' } : null
          }));
        }
        const currentPrivacy = currentUserState?.privacy || { showServer: true, allowRequests: true, allowServerInvites: true };

        if (loopCount % 4 === 0) {
          await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${myUuid}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: myUsername,
              state: currentState,
              server: currentLaunchedServer,
              lastActive: Date.now(),
              privacy: currentPrivacy
            })
          });
        }

        const friendsRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friends/${myUuid}.json`);
        const friendsData = await friendsRes.json();
        
        let friendsList: FriendsFriendUser[] = [];
        if (friendsData) {
          const friendUuids = Object.keys(friendsData);
          const friendsDetails = await Promise.all(
            friendUuids.map(async (fUuid) => {
              try {
                const userRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${fUuid}.json`);
                const userData = await userRes.json();
                if (userData) {
                  const pingEnabled = friendsData[fUuid]?.pingEnabled || false;
                  const isOffline = !userData.lastActive || (Date.now() - userData.lastActive > 45000) || userData.state === 'INVISIBLE';
                  const onlineState: OnlineState = isOffline ? 'OFFLINE' : userData.state;
                  const serverAddress = isOffline ? null : userData.server;

                  return {
                    uuid: fUuid,
                    username: userData.username || 'Unknown',
                    state: onlineState,
                    server: serverAddress,
                    pingEnabled,
                    avatarUrl: userData.avatarUrl || null
                  } as FriendsFriendUser;
                }
              } catch (err) {
                console.error("Failed to fetch details in loop for:", fUuid, err);
              }
              return null;
            })
          );
          friendsList = friendsDetails.filter((f): f is FriendsFriendUser => f !== null);
        }

        friendsList.forEach(f => {
          const prevState = previousStates[f.uuid];
          if (prevState !== undefined && prevState !== f.state) {
            if (f.state === 'OFFLINE' && get().notificationsEnabled) {
              toast.player(i18n.t('friends.notifications.offline', { username: f.username }), f.uuid);
            } else if (['ONLINE', 'AFK', 'BUSY'].includes(f.state) && prevState === 'OFFLINE' && get().notificationsEnabled) {
              toast.player(i18n.t('friends.notifications.online', { username: f.username }), f.uuid);
            }
          }
          previousStates[f.uuid] = f.state;
        });

        set({ friends: friendsList, lastFetchedAt: Date.now() });

        const reqsRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/friendRequests/${myUuid}.json`);
        const reqsData = await reqsRes.json();
        let requestsList: FriendRequestWithUsers[] = [];
        if (reqsData) {
          const keys = Object.keys(reqsData);
          requestsList = await Promise.all(keys.map(async (key) => {
            const req = reqsData[key];
            try {
              const senderRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${req.senderUuid}.json`);
              const senderData = await senderRes.json();
              const receiverRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${req.receiverUuid}.json`);
              const receiverData = await receiverRes.json();
              return {
                id: req.id || key,
                sender: req.senderUuid,
                receiver: req.receiverUuid,
                state: req.state || 'PENDING',
                timestamp: req.timestamp || Date.now(),
                users: [
                  { 
                    uuid: req.senderUuid, 
                    username: senderData?.username || req.senderUsername,
                    avatarUrl: senderData?.avatarUrl || null
                  },
                  { 
                    uuid: req.receiverUuid, 
                    username: receiverData?.username || req.receiverUsername,
                    avatarUrl: receiverData?.avatarUrl || null
                  }
                ]
              };
            } catch (err) {
              console.error("Failed to load details for request in loop:", key, err);
              return {
                id: req.id || key,
                sender: req.senderUuid,
                receiver: req.receiverUuid,
                state: req.state || 'PENDING',
                timestamp: req.timestamp || Date.now(),
                users: [
                  { uuid: req.senderUuid, username: req.senderUsername, avatarUrl: null },
                  { uuid: req.receiverUuid, username: req.receiverUsername, avatarUrl: null }
                ]
              };
            }
          }));
        }

        const incomingReqs = requestsList.filter(r => r.receiver === myUuid);
        if (previousRequestsCount !== -1 && incomingReqs.length > previousRequestsCount && get().notificationsEnabled) {
          const newReq = incomingReqs.find(r => r.timestamp > (Date.now() - 10000));
          if (newReq) {
            const senderUser = newReq.users.find(u => u.uuid !== myUuid);
            if (senderUser) {
              toast.player(i18n.t('friends.notifications.friend_request', { name: senderUser.username }), senderUser.uuid);
            }
          }
        }
        previousRequestsCount = incomingReqs.length;
        set({ pendingRequests: requestsList });

        const activeFriend = get().activeChatFriend;
        if (activeFriend) {
          const sortedIds = [myUuid, activeFriend.uuid].sort();
          const chatId = `${sortedIds[0]}_${sortedIds[1]}`;

          const msgRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/messages/${chatId}.json`);
          const msgData = await msgRes.json();
          let messagesList: ChatMessage[] = [];
          if (msgData) {
            messagesList = Object.keys(msgData).map(key => ({
              _id: key,
              chatId: msgData[key].chatId || chatId,
              senderId: msgData[key].senderId,
              content: msgData[key].content,
              timestamp: msgData[key].timestamp,
              reactions: msgData[key].reactions || []
            }));
            messagesList.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          }

          useChatStore.setState({ messages: messagesList });

          const typingRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/chats/${chatId}/typing.json`);
          const typingData = await typingRes.json();
          const typingSet = new Set<string>();
          if (typingData) {
            Object.keys(typingData).forEach(uId => {
              if (uId !== myUuid && (Date.now() - typingData[uId] < 5000)) {
                typingSet.add(uId);
              }
            });
          }
          useChatStore.setState({ typingUsers: typingSet });
        }

        if (get().notificationsEnabled) {
          await Promise.all(
            friendsList.map(async (friend) => {
              const sortedIds = [myUuid, friend.uuid].sort();
              const chatId = `${sortedIds[0]}_${sortedIds[1]}`;
              
              if (activeFriend?.uuid === friend.uuid) return;

              const chatRes = await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/chats/${chatId}.json`);
              const chatData = await chatRes.json();
              
              if (chatData?.latestMessage) {
                const latest = chatData.latestMessage;
                const lastNotified = lastNotifiedMessageTimestamps[chatId] || 0;
                
                if (latest.senderId === friend.uuid && latest.timestamp > lastNotified) {
                  if (latest.timestamp > Date.now() - 15000) {
                    const preview = latest.content.slice(0, 50) + (latest.content.length > 50 ? "..." : "");
                    toast.player(i18n.t('friends.notifications.chat_preview', { name: friend.username, message: preview }), friend.uuid);
                  }
                  lastNotifiedMessageTimestamps[chatId] = latest.timestamp;
                }
              }
            })
          );
        }

        loopCount++;
      } catch (err) {
        console.error("Error in friends sync loop:", err);
      }
    };

    await syncLoop();

    const interval = window.setInterval(syncLoop, 3000);
    set({ intervalId: interval });
  },

  disconnectWebSocket: async () => {
    const interval = get().intervalId;
    if (interval) {
      clearInterval(interval);
      set({ intervalId: null });
    }
    set({ wsConnected: false });
  },

  updateFriendStatus: (uuid: string, state: OnlineState) => {
    set((s) => ({
      friends: s.friends.map((f) =>
        f.uuid === uuid ? { ...f, state } : f
      ),
    }));
  },

  updateFriendServer: (uuid: string, server: string | null) => {
    set((s) => ({
      friends: s.friends.map((f) =>
        f.uuid === uuid ? { ...f, server } : f
      ),
    }));
  },

  updateFriendState: (uuid: string, state: OnlineState, server?: string) => {
    set((s) => ({
      friends: s.friends.map((f) =>
        f.uuid === uuid ? { ...f, state, server: server ?? f.server } : f
      ),
    }));
  },

  addFriend: (friend: FriendsFriendUser) => {
    set((s) => ({
      friends: [...s.friends.filter((f) => f.uuid !== friend.uuid), friend],
    }));
  },

  removeFriendFromList: (uuid: string) => {
    set((s) => ({
      friends: s.friends.filter((f) => f.uuid !== uuid),
    }));
  },

  removeFriendByUuid: (uuid: string) => {
    set((s) => ({
      friends: s.friends.filter((f) => f.uuid !== uuid),
    }));
  },

  setWsConnected: (connected: boolean) => {
    set({ wsConnected: connected });
  },

  addPendingRequest: (request: FriendRequestWithUsers) => {
    set((s) => ({
      pendingRequests: [...s.pendingRequests, request],
    }));
  },

  removePendingRequest: (id: string) => {
    set((s) => ({
      pendingRequests: s.pendingRequests.filter((r) => r.id !== id),
    }));
  },

  openChat: (friend: FriendsFriendUser) => set({ activeChatFriend: friend, isSettingsOpen: false }),
  closeChat: () => set({ activeChatFriend: null }),
  toggleNotifications: () => set((s) => ({ notificationsEnabled: !s.notificationsEnabled })),
  openSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen, activeChatFriend: null })),
  closeSettings: () => set({ isSettingsOpen: false }),

  updatePrivacySetting: async (setting: string, value: boolean) => {
    try {
      const { currentUser } = get();
      if (!currentUser) return;
      
      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${currentUser.uuid}/privacy/${setting}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
      });

      set((state) => ({
        currentUser: state.currentUser
          ? {
              ...state.currentUser,
              privacy: {
                ...state.currentUser.privacy,
                [setting === 'showServer' ? 'showServer' : setting === 'allowRequests' ? 'allowRequests' : 'allowServerInvites']: value,
              },
            }
          : null,
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  updateFriendsProfile: async (newAvatarUrl: string) => {
    set({ isLoading: true, error: null });
    try {
      const account = get().friendsAccount;
      if (!account) throw new Error("Not logged into friends account");
      
      const myUuid = account.uuid;
      
      // Patch user profile
      const cleanAvatarUrl = newAvatarUrl.trim();
      await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${myUuid}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatarUrl: cleanAvatarUrl || null
        })
      });
      
      set({
        currentUser: get().currentUser ? {
          ...get().currentUser!,
          avatarUrl: cleanAvatarUrl || null
        } : null,
        isLoading: false
      });
      
      await get().loadFriends(true);
    } catch (e: any) {
      set({ error: e.message || String(e), isLoading: false });
      throw e;
    }
  },

  syncWithMinecraftAccount: async (minecraftAccount: any | null) => {
    const currentAccount = get().friendsAccount;
    
    if (!minecraftAccount) {
      if (currentAccount) {
        await get().logoutFriendsAccount();
      }
      return;
    }
    
    const mcId = minecraftAccount.id;
    const savedKey = `prime_friends_account_${mcId}`;
    const saved = localStorage.getItem(savedKey);
    
    if (saved) {
      try {
        const accountObj = JSON.parse(saved);
        if (!currentAccount || currentAccount.uuid !== accountObj.uuid) {
          if (currentAccount) {
            await get().disconnectWebSocket();
            try {
              await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${currentAccount.uuid}/state.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify('OFFLINE')
              });
              await fetch(`https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users/${currentAccount.uuid}/lastActive.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(0)
              });
            } catch (e) {
              console.error("Failed to mark old session offline on switch:", e);
            }
          }
          
          set({ 
            friendsAccount: accountObj,
            isLoading: true,
            error: null
          });
          
          await get().loadCurrentUser();
          await get().setStatus('ONLINE');
          await get().loadFriends(true);
          await get().connectWebSocket();
          set({ isLoading: false });
        }
      } catch (e) {
        console.error("Failed to parse saved friends account for MC account:", mcId, e);
      }
    } else {
      if (currentAccount) {
        await get().logoutFriendsAccount();
      }
    }
  },
}));

// Subscribe to Minecraft auth store to sync accounts
let lastActiveAccountId: string | null = null;
useMinecraftAuthStore.subscribe((state) => {
  const currentActiveAccount = state.activeAccount;
  const currentId = currentActiveAccount ? currentActiveAccount.id : null;
  if (currentId !== lastActiveAccountId) {
    lastActiveAccountId = currentId;
    useFriendsStore.getState().syncWithMinecraftAccount(currentActiveAccount);
  }
});
