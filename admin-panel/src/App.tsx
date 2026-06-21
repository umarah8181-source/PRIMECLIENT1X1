import React, { useState, useEffect } from "react";
import { Server, Plus, Trash2, Edit3, Save, RotateCcw, AlertTriangle, Bell, Send, Users } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface MinecraftServer {
  id: string;
  name: string;
  address: string;
  type: "standard" | "partner";
  order: number;
}

interface CustomNotification {
  id: string;
  title: string;
  message: string;
  createdAt: string;
}

const DATABASE_URL = "https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/servers.json";
const NOTIFICATIONS_URL = "https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/notifications.json";

export default function App() {
  const [activeTab, setActiveTab] = useState<"servers" | "notifications" | "updates" | "active-users">("servers");
  
  // Active Users State
  const [activeUsersCount, setActiveUsersCount] = useState<number | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  
  // Servers State
  const [servers, setServers] = useState<MinecraftServer[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Servers Form State
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<"standard" | "partner">("standard");
  const [order, setOrder] = useState<number>(0);

  // Notifications State
  const [notifications, setNotifications] = useState<CustomNotification[]>([]);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [notifLoading, setNotifLoading] = useState(false);

  // Error/Success Notifications
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Updates State
  const [updateVersion, setUpdateVersion] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [updateFilePath, setUpdateFilePath] = useState<string | null>(null);
  const [customDownloadUrl, setCustomDownloadUrl] = useState("");
  const [uploadingUpdate, setUploadingUpdate] = useState(false);
  const [currentVersionInfo, setCurrentVersionInfo] = useState<{ version: string; url: string; notes?: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ percent: number; uploaded: number; total: number } | null>(null);

  // GitHub Configuration State
  const [githubRepo, setGithubRepo] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [uploadTarget, setUploadTarget] = useState<"catbox" | "github">("catbox");

  const loadGithubConfig = async () => {
    try {
      const config = await invoke<{ github_repo: string | null; github_token: string | null }>("load_admin_config");
      if (config.github_repo) setGithubRepo(config.github_repo);
      if (config.github_token) setGithubToken(config.github_token);
      if (config.github_repo && config.github_token) {
        setUploadTarget("github");
      }
    } catch (err) {
      console.error("Failed to load GitHub config:", err);
    }
  };

  const handleSaveGithubConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      await invoke("save_admin_config", {
        config: {
          github_repo: githubRepo.trim() || null,
          github_token: githubToken.trim() || null,
        }
      });
      showNotification("success", "GitHub settings successfully saved!");
    } catch (err: any) {
      let msg = "Failed to save settings";
      if (err && typeof err === "object" && err.message) msg = err.message;
      else if (typeof err === "string") msg = err;
      showNotification("error", msg);
    }
  };

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchCurrentUpdateInfo = async () => {
    try {
      const response = await fetch("https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/update.json");
      if (!response.ok) throw new Error("Failed to fetch update info");
      const data = await response.json();
      if (data) {
        setCurrentVersionInfo(data);
        setUpdateVersion(data.version || "");
        setUpdateNotes(data.notes || "");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBrowseFile = async () => {
    try {
      const selectedPath = await invoke<string | null>("select_installer_file");
      if (selectedPath) {
        setUpdateFilePath(selectedPath);
      }
    } catch (err: any) {
      showNotification("error", "Failed to open file dialog: " + err.message);
    }
  };

  const handlePublishUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updateVersion.trim() || !updateNotes.trim()) {
      showNotification("error", "Please fill in all required fields");
      return;
    }

    setUploadingUpdate(true);
    setUploadProgress(null);

    try {
      let finalUrl = customDownloadUrl.trim();

      if (!finalUrl && !updateFilePath && !currentVersionInfo?.url) {
        throw new Error("Please select an EXE file to upload or enter a direct download URL.");
      }

      if (updateFilePath && !finalUrl) {
        if (uploadTarget === "github") {
          showNotification("success", "Uploading EXE to GitHub Releases... Please wait.");
        } else {
          showNotification("success", "Uploading EXE to cloud storage... Please wait.");
        }
      } else {
        showNotification("success", "Publishing metadata updates... Please wait.");
      }

      await invoke<string>("publish_update", {
        filePath: finalUrl ? null : updateFilePath,
        version: updateVersion.trim(),
        notes: updateNotes.trim(),
        existingUrl: finalUrl || currentVersionInfo?.url || null,
        pubDate: new Date().toISOString(),
        githubConfig: (uploadTarget === "github" && !finalUrl && updateFilePath) ? {
          repo: githubRepo.trim(),
          token: githubToken.trim()
        } : null
      });

      showNotification("success", `Update to version ${updateVersion} successfully published!`);
      setUpdateFilePath(null);
      setCustomDownloadUrl("");
      fetchCurrentUpdateInfo();
    } catch (err: any) {
      console.error(err);
      let errMsg = "Failed to publish update";
      if (typeof err === "string") {
        errMsg = err;
      } else if (err && typeof err === "object" && err.message) {
        errMsg = err.message;
      } else if (err) {
        errMsg = JSON.stringify(err);
      }
      showNotification("error", errMsg);
    } finally {
      setUploadingUpdate(false);
      setUploadProgress(null);
    }
  };

  const handleRemoveUpdate = async () => {
    if (!window.confirm("Are you sure you want to remove the active update? Users will no longer be prompted to update.")) {
      return;
    }
    try {
      await invoke("remove_update");
      showNotification("success", "Active update successfully removed.");
      setCurrentVersionInfo(null);
      setUpdateVersion("");
      setUpdateNotes("");
    } catch (err: any) {
      console.error(err);
      let errMsg = "Failed to remove update";
      if (typeof err === "string") {
        errMsg = err;
      } else if (err && typeof err === "object" && err.message) {
        errMsg = err.message;
      }
      showNotification("error", errMsg);
    }
  };

  const fetchServers = async () => {
    setLoading(true);
    try {
      const response = await fetch(DATABASE_URL);
      if (!response.ok) throw new Error("Failed to fetch servers from Firebase");
      const data = await response.json();
      if (data) {
        const parsed = Object.entries(data)
          .filter(([_, val]) => val !== null && typeof val === "object")
          .map(([id, val]: [string, any]) => ({
            id,
            name: val.name || "",
            address: val.address || "",
            type: val.type || "standard",
            order: Number(val.order) || 0,
          }));
        parsed.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
        setServers(parsed);
      } else {
        setServers([]);
      }
    } catch (err) {
      console.error(err);
      showNotification("error", "Error connecting to Firebase Database");
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
    setNotifLoading(true);
    try {
      const response = await fetch(NOTIFICATIONS_URL);
      if (!response.ok) throw new Error("Failed to fetch notifications from Firebase");
      const data = await response.json();
      if (data) {
        const parsed = Object.entries(data)
          .filter(([_, val]) => val !== null && typeof val === "object")
          .map(([id, val]: [string, any]) => ({
            id,
            title: val.title || "",
            message: val.message || "",
            createdAt: val.createdAt || new Date().toISOString(),
          }));
        // Sort newest first
        parsed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setNotifications(parsed);
      } else {
        setNotifications([]);
      }
    } catch (err) {
      console.error(err);
      showNotification("error", "Error loading notifications from Firebase");
    } finally {
      setNotifLoading(false);
    }
  };

  const fetchActiveUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch("https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/users.json");
      if (!response.ok) throw new Error("Failed to fetch users");
      const data = await response.json();
      if (data) {
        const now = Date.now();
        const activeList: any[] = [];
        Object.entries(data).forEach(([uuid, val]: [string, any]) => {
          if (val && typeof val === "object") {
            const isOnline = val.state === "ONLINE" || val.state === "PLAYING";
            const wasActiveRecently = val.lastActive && (now - val.lastActive <= 45000);
            if (isOnline || wasActiveRecently) {
              activeList.push({
                uuid,
                username: val.username || "Unknown",
                state: val.state || "ONLINE",
                lastActive: val.lastActive || 0,
              });
            }
          }
        });
        activeList.sort((a, b) => {
          if (a.state === "PLAYING" && b.state !== "PLAYING") return -1;
          if (a.state !== "PLAYING" && b.state === "PLAYING") return 1;
          return a.username.localeCompare(b.username);
        });
         setActiveUsersCount(activeList.length);
      } else {
        setActiveUsersCount(0);
      }
    } catch (err) {
      console.error("Failed to load active users:", err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchServers();
    fetchNotifications();
    fetchCurrentUpdateInfo();
    loadGithubConfig();
    fetchActiveUsers();

    // Poll active users every 15 seconds to keep count accurate
    const interval = setInterval(fetchActiveUsers, 15000);

    let unlistenProgress: (() => void) | null = null;
    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<{ percent: number; uploaded: number; total: number }>(
        "upload_progress",
        (event) => {
          setUploadProgress(event.payload);
        }
      );
      unlistenProgress = unlisten;
    };
    setupListener();

    return () => {
      clearInterval(interval);
      if (unlistenProgress) {
        unlistenProgress();
      }
    };
  }, []);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setAddress("");
    setType("standard");
    setOrder(0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) {
      showNotification("error", "Please fill in all fields");
      return;
    }

    const serverData = {
      name: name.trim(),
      address: address.trim().toLowerCase(),
      type,
      order: Number(order) || 0,
    };

    try {
      if (editId) {
        // Edit existing server
        const url = `https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/servers/${editId}.json`;
        const response = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(serverData),
        });
        if (!response.ok) throw new Error("Failed to update server");
        showNotification("success", "Server updated successfully!");
      } else {
        // Add new server
        const response = await fetch(DATABASE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(serverData),
        });
        if (!response.ok) throw new Error("Failed to add server");
        showNotification("success", "Server added successfully!");
      }
      resetForm();
      fetchServers();
    } catch (err) {
      console.error(err);
      showNotification("error", "Failed to save server data to Firebase");
    }
  };

  const handleEdit = (srv: MinecraftServer) => {
    setEditId(srv.id);
    setName(srv.name);
    setAddress(srv.address);
    setType(srv.type);
    setOrder(srv.order || 0);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this server?")) return;

    try {
      const url = `https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/servers/${id}.json`;
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete server");
      showNotification("success", "Server deleted successfully!");
      fetchServers();
      if (editId === id) resetForm();
    } catch (err) {
      console.error(err);
      showNotification("error", "Failed to delete server from Firebase");
    }
  };

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifTitle.trim() || !notifMessage.trim()) {
      showNotification("error", "Please fill in all fields");
      return;
    }

    const notifData = {
      title: notifTitle.trim(),
      message: notifMessage.trim(),
      createdAt: new Date().toISOString(),
    };

    try {
      const response = await fetch(NOTIFICATIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notifData),
      });
      if (!response.ok) throw new Error("Failed to send notification");
      showNotification("success", "Notification sent successfully!");
      setNotifTitle("");
      setNotifMessage("");
      fetchNotifications();
    } catch (err) {
      console.error(err);
      showNotification("error", "Failed to send notification to Firebase");
    }
  };

  const handleDeleteNotification = async (id: string) => {
    if (!confirm("Are you sure you want to delete this notification?")) return;

    try {
      const url = `https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/notifications/${id}.json`;
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete notification");
      showNotification("success", "Notification deleted successfully!");
      fetchNotifications();
    } catch (err) {
      console.error(err);
      showNotification("error", "Failed to delete notification from Firebase");
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>
          <Server size={32} style={{ color: "#3b82f6" }} />
          Prime Client Admin <span>v1.0</span>
          {activeUsersCount !== null && (
            <span style={{ 
              fontSize: "0.85rem", 
              color: "#34d399", 
              background: "rgba(52, 211, 153, 0.1)", 
              padding: "0.25rem 0.75rem", 
              borderRadius: "9999px", 
              marginLeft: "1rem", 
              display: "inline-flex", 
              alignItems: "center", 
              gap: "0.25rem",
              fontWeight: 600,
              verticalAlign: "middle"
            }}>
              <span className="pulse-indicator" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#34d399", display: "inline-block" }}></span>
              {activeUsersCount} Active Users
            </span>
          )}
        </h1>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button 
            className={`btn ${activeTab === "servers" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("servers")}
            style={{ width: "auto", padding: "0.5rem 1rem" }}
          >
            <Server size={16} />
            Servers
          </button>
          <button 
            className={`btn ${activeTab === "notifications" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("notifications")}
            style={{ width: "auto", padding: "0.5rem 1rem" }}
          >
            <Bell size={16} />
            Notifications
          </button>
          <button 
            className={`btn ${activeTab === "updates" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("updates")}
            style={{ width: "auto", padding: "0.5rem 1rem" }}
          >
            <Plus size={16} />
            Client Updates
          </button>
          <button 
            className={`btn ${activeTab === "active-users" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("active-users")}
            style={{ width: "auto", padding: "0.5rem 1rem" }}
          >
            <Users size={16} />
            Active Users ({activeUsersCount !== null ? activeUsersCount : 0})
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={activeTab === "servers" ? fetchServers : activeTab === "notifications" ? fetchNotifications : activeTab === "active-users" ? fetchActiveUsers : fetchCurrentUpdateInfo} 
            disabled={loading || notifLoading || uploadingUpdate || loadingUsers} 
            style={{ width: "auto", padding: "0.5rem 1rem" }}
          >
            <RotateCcw size={16} className={(loading || notifLoading || uploadingUpdate || loadingUsers) ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      {notification && (
        <div 
          style={{
            padding: "1rem",
            marginBottom: "1.5rem",
            borderRadius: "8px",
            background: notification.type === "success" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
            border: notification.type === "success" ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(239, 68, 68, 0.3)",
            color: notification.type === "success" ? "#34d399" : "#f87171",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontWeight: 600,
            fontSize: "0.95rem"
          }}
        >
          <AlertTriangle size={18} />
          {notification.message}
        </div>
      )}

      {activeTab === "servers" && (
        <div className="dashboard-grid">
          {/* Left Side: Form */}
          <div className="glass-panel">
            <h2>
              {editId ? <Edit3 size={20} /> : <Plus size={20} />}
              {editId ? "Edit Server Connection" : "Add New Server"}
            </h2>
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Server Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. Doxenia SMP" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Server Address (IP)</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. play.doxenia.fun" 
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Server Type / Category</label>
                <select 
                  className="form-control"
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                >
                  <option value="standard">Standard Server</option>
                  <option value="partner">Featured Partner Server</option>
                </select>
              </div>

              <div className="form-group">
                <label>Sort Order / Number</label>
                <input 
                  type="number" 
                  className="form-control" 
                  placeholder="e.g. 1" 
                  value={order}
                  onChange={(e) => setOrder(Number(e.target.value) || 0)}
                />
              </div>

              <div className="btn-group">
                <button type="submit" className="btn btn-primary">
                  <Save size={16} />
                  {editId ? "Save Changes" : "Create Server"}
                </button>
                {editId && (
                  <button type="button" className="btn btn-secondary" onClick={resetForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Right Side: Servers List */}
          <div className="glass-panel">
            <h2>
              <Server size={20} />
              Configured Servers List ({servers.length})
            </h2>

            {loading ? (
              <div className="empty-state animate-pulse">Loading servers from Firebase Realtime Database...</div>
            ) : servers.length === 0 ? (
              <div className="empty-state">No servers configured in Firebase. Add one to get started!</div>
            ) : (
              <div className="server-list">
                {servers.map((srv) => (
                  <div key={srv.id} className="server-item">
                    <div className="server-info">
                      <img 
                        src={`https://api.mcsrvstat.us/icon/${srv.address}`}
                        alt="icon" 
                        className="server-favicon"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2'%3E%3Crect x='2' y='2' width='20' height='8' rx='2'/%3E%3Crect x='2' y='14' width='20' height='8' rx='2'/%3E%3Cline x1='6' y1='6' x2='6.01' y2='6'/%3E%3Cline x1='6' y1='18' x2='6.01' y2='18'/%3E%3C/svg%3E";
                        }}
                      />
                      <div className="server-details">
                        <div className="server-name">
                          #{srv.order} {srv.name}
                          <span className={`badge badge-${srv.type}`}>
                            {srv.type}
                          </span>
                        </div>
                        <div className="server-address">{srv.address}</div>
                      </div>
                    </div>

                    <div className="server-actions">
                      <button className="action-btn action-btn-edit" title="Edit Server" onClick={() => handleEdit(srv)}>
                        <Edit3 size={16} />
                      </button>
                      <button className="action-btn action-btn-delete" title="Delete Server" onClick={() => handleDelete(srv.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="dashboard-grid">
          {/* Left Side: Create Notification */}
          <div className="glass-panel">
            <h2>
              <Send size={20} />
              Send Global Announcement
            </h2>
            <form onSubmit={handleSendNotification}>
              <div className="form-group">
                <label>Notification Title</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. Server Maintenance" 
                  value={notifTitle}
                  onChange={(e) => setNotifTitle(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Message Content</label>
                <textarea 
                  className="form-control" 
                  placeholder="Enter the notification message here..." 
                  value={notifMessage}
                  onChange={(e) => setNotifMessage(e.target.value)}
                  style={{ 
                    minHeight: "120px", 
                    resize: "vertical", 
                    background: "rgba(0,0,0,0.3)", 
                    border: "1px solid rgba(255,255,255,0.1)", 
                    borderRadius: "4px", 
                    padding: "0.75rem", 
                    color: "white", 
                    fontFamily: "inherit" 
                  }}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ marginTop: "1rem" }}>
                <Send size={16} />
                Send Notification
              </button>
            </form>
          </div>

          {/* Right Side: Sent Notifications List */}
          <div className="glass-panel">
            <h2>
              <Bell size={20} />
              Sent Announcements ({notifications.length})
            </h2>

            {notifLoading ? (
              <div className="empty-state animate-pulse">Loading notifications from Firebase...</div>
            ) : notifications.length === 0 ? (
              <div className="empty-state">No announcements sent yet. Send one to alert users!</div>
            ) : (
              <div className="server-list">
                {notifications.map((notif) => (
                  <div key={notif.id} className="server-item" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem", padding: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ fontWeight: 600, fontSize: "1.1rem", color: "white" }}>{notif.title}</div>
                      <button 
                        className="action-btn action-btn-delete" 
                        title="Delete Notification" 
                        onClick={() => handleDeleteNotification(notif.id)}
                        style={{ padding: "4px", height: "auto" }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.7)", lineBreak: "anywhere", whiteSpace: "pre-wrap" }}>{notif.message}</div>
                    <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>
                      Sent on: {new Date(notif.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "updates" && (
        <div className="dashboard-grid">
          {/* Left Side: Publish Update */}
          <div className="glass-panel">
            <h2>
              <Send size={20} />
              Publish Client Update
            </h2>
            <form onSubmit={handlePublishUpdate}>
              <div className="form-group">
                <label>New Version Number</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. 1.0.1" 
                  value={updateVersion}
                  onChange={(e) => setUpdateVersion(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Release Notes / Changelog</label>
                <textarea 
                  className="form-control" 
                  placeholder="Enter what's new in this release..." 
                  value={updateNotes}
                  onChange={(e) => setUpdateNotes(e.target.value)}
                  style={{ 
                    minHeight: "100px", 
                    resize: "vertical", 
                    background: "rgba(0,0,0,0.3)", 
                    border: "1px solid rgba(255,255,255,0.1)", 
                    borderRadius: "4px", 
                    padding: "0.75rem", 
                    color: "white", 
                    fontFamily: "inherit" 
                  }}
                  required
                />
              </div>

              <div className="form-group">
                <label>Select Installer EXE File (to upload)</label>
                <div style={{ display: "flex", gap: "10px" }}>
                  <input 
                    type="text" 
                    className="form-control" 
                    readOnly
                    placeholder="No file selected" 
                    value={updateFilePath || ""}
                    style={{ flex: 1 }}
                  />
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    onClick={handleBrowseFile}
                    style={{ width: "auto", whiteSpace: "nowrap" }}
                  >
                    Browse...
                  </button>
                </div>
              </div>

              <div style={{ textAlign: "center", margin: "0.5rem 0", color: "rgba(255,255,255,0.4)", fontWeight: "bold" }}>
                — OR —
              </div>

              <div className="form-group">
                <label>Direct Download URL (Manual Input)</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. https://example.com/installer.exe" 
                  value={customDownloadUrl}
                  onChange={(e) => setCustomDownloadUrl(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginTop: "1rem", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "1rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none", color: "white", fontWeight: 500 }}>
                  <input 
                    type="checkbox" 
                    checked={uploadTarget === "github"} 
                    onChange={(e) => setUploadTarget(e.target.checked ? "github" : "catbox")}
                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                  />
                  Publish via GitHub Releases (Recommended)
                </label>
              </div>

              {uploadTarget === "github" && (
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "14px", borderRadius: "6px", marginTop: "0.75rem", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <div className="form-group">
                    <label style={{ fontSize: "0.85rem", opacity: 0.8 }}>GitHub Repository (owner/repo)</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="e.g. MyOrg/PrimeClient" 
                      value={githubRepo}
                      onChange={(e) => setGithubRepo(e.target.value)}
                      required={uploadTarget === "github" && !customDownloadUrl.trim()}
                      style={{ marginTop: "4px" }}
                    />
                  </div>
                  <div className="form-group" style={{ marginTop: "0.75rem" }}>
                    <label style={{ fontSize: "0.85rem", opacity: 0.8 }}>Personal Access Token (PAT)</label>
                    <input 
                      type="password" 
                      className="form-control" 
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" 
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      required={uploadTarget === "github" && !customDownloadUrl.trim()}
                      style={{ marginTop: "4px" }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      onClick={() => handleSaveGithubConfig()}
                      style={{ fontSize: "0.85rem", padding: "6px 12px", width: "auto", minHeight: "auto", height: "auto" }}
                    >
                      Save GitHub Credentials
                    </button>
                  </div>
                </div>
              )}

              <button type="submit" className="btn btn-primary" style={{ marginTop: "1rem" }} disabled={uploadingUpdate}>
                {uploadingUpdate ? "Uploading Installer & Publishing..." : "Publish Update"}
              </button>
              {uploadingUpdate && uploadProgress && (
                <div style={{ marginTop: "1rem", background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", marginBottom: "4px" }}>
                    <span>Uploading installer...</span>
                    <span>{uploadProgress.percent}%</span>
                  </div>
                  <div style={{ width: "100%", height: "8px", background: "rgba(255,255,255,0.1)", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ width: `${uploadProgress.percent}%`, height: "100%", background: "#3b82f6", transition: "width 0.2s" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>
                    <span>{(uploadProgress.uploaded / (1024 * 1024)).toFixed(2)} MB / {(uploadProgress.total / (1024 * 1024)).toFixed(2)} MB</span>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Right Side: Current Update Info */}
          <div className="glass-panel">
            <h2>
              <AlertTriangle size={20} style={{ color: "#eab308" }} />
              Active Update Status
            </h2>

            {currentVersionInfo ? (
              <div className="server-list" style={{ gap: "1.5rem" }}>
                <div className="server-item" style={{ flexDirection: "column", alignItems: "stretch", padding: "1.25rem", gap: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: "1.25rem", color: "white" }}>
                      Version: <span style={{ color: "#3b82f6" }}>{currentVersionInfo.version}</span>
                    </div>
                    <span className="badge badge-standard" style={{ background: "#10b981", color: "white" }}>Live</span>
                  </div>
                  
                  <div style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.6)" }}>
                    <strong>Installer URL:</strong> 
                    <div style={{ wordBreak: "break-all", color: "#60a5fa", marginTop: "0.25rem", fontSize: "0.85rem" }}>
                      {currentVersionInfo.url}
                    </div>
                  </div>

                  <div style={{ fontSize: "0.95rem", color: "rgba(255,255,255,0.8)", whiteSpace: "pre-wrap" }}>
                    <strong>Release Notes:</strong>
                    <div style={{ padding: "0.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "4px", marginTop: "0.25rem", fontSize: "0.9rem" }}>
                      {currentVersionInfo.notes || "No notes provided."}
                    </div>
                  </div>

                  <button 
                    onClick={handleRemoveUpdate}
                    className="btn btn-danger"
                    style={{ 
                      marginTop: "1rem", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "center", 
                      gap: "0.5rem",
                      backgroundColor: "#ef4444",
                      color: "white"
                    }}
                  >
                    <Trash2 size={16} />
                    Remove Active Update
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty-state">No active client update information found in Firebase. Publish one to initialize!</div>
            )}
          </div>
        </div>
      )}

      {activeTab === "active-users" && (
        <div className="glass-panel" style={{ maxWidth: "600px", margin: "0 auto", textAlign: "center", padding: "3rem 2rem" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "80px", height: "80px", borderRadius: "50%", background: "rgba(52, 211, 153, 0.1)", border: "2px solid rgba(52, 211, 153, 0.3)", marginBottom: "1.5rem", boxShadow: "0 0 20px rgba(52, 211, 153, 0.2)" }}>
            <Users size={36} style={{ color: "#34d399" }} />
          </div>
          
          <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem", justifyContent: "center" }}>Active Players</h2>
          <p style={{ color: "rgba(255, 255, 255, 0.5)", marginBottom: "2rem" }}>
            The total number of clients currently active and playing.
          </p>

          {loadingUsers ? (
            <div style={{ padding: "1.5rem" }}>
              <RotateCcw className="animate-spin" size={32} style={{ margin: "0 auto" }} />
              <p style={{ marginTop: "1rem", color: "rgba(255, 255, 255, 0.5)" }}>Refreshing active player count...</p>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: "5rem", fontWeight: 800, color: "#34d399", textShadow: "0 0 30px rgba(52, 211, 153, 0.4)", lineHeight: 1, fontFamily: "monospace" }}>
                {activeUsersCount !== null ? activeUsersCount : 0}
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem", background: "rgba(255, 255, 255, 0.05)", padding: "0.5rem 1.25rem", borderRadius: "20px", fontSize: "0.9rem", color: "rgba(255, 255, 255, 0.8)", border: "1px solid rgba(255, 255, 255, 0.1)" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#34d399", display: "inline-block", boxShadow: "0 0 8px #34d399" }}></span>
                Live Client Count
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
