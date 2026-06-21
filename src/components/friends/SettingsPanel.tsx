import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n/i18n";
import { Icon } from "@iconify/react";
import { useFriendsStore, OnlineState } from "../../store/friends-store";
import { useThemeStore } from "../../store/useThemeStore";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";
import { StatusSelector } from "./StatusSelector";
import { toast } from "react-hot-toast";

const getStatusConfig = (): Record<OnlineState, { color: string; label: string; glow: string }> => ({
  ONLINE: { color: "#22c55e", label: i18n.t('friends.status.online'), glow: "0 0 8px rgba(34, 197, 94, 0.6)" },
  AFK: { color: "#f97316", label: i18n.t('friends.status.away'), glow: "0 0 8px rgba(249, 115, 22, 0.6)" },
  BUSY: { color: "#ef4444", label: i18n.t('friends.status.busy'), glow: "0 0 8px rgba(239, 68, 68, 0.6)" },
  OFFLINE: { color: "#6b7280", label: i18n.t('friends.status.offline'), glow: "none" },
  INVISIBLE: { color: "#6b7280", label: i18n.t('friends.status.invisible'), glow: "none" },
});

interface PrivacyToggleProps {
  label: string;
  description: string;
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
  accentColor: string;
}

function PrivacyToggle({ label, description, enabled, loading, onToggle, accentColor }: PrivacyToggleProps) {
  return (
    <div
      className="flex items-center justify-between p-3 rounded-xl transition-all duration-200"
      style={{
        backgroundColor: `${accentColor}15`,
        border: `1px solid ${accentColor}40`,
      }}
    >
      <div className="flex-1 min-w-0 mr-3">
        <div className="text-sm font-medium text-white font-minecraft-ten">{label}</div>
        <div className="text-lg text-white/50 font-minecraft mt-0.5">{description}</div>
      </div>
      <button
        onClick={onToggle}
        disabled={loading}
        className="relative w-11 h-6 rounded-full transition-all duration-200 flex-shrink-0 flex items-center"
        style={{
          backgroundColor: enabled ? `${accentColor}60` : "rgba(255, 255, 255, 0.1)",
          border: `1px solid ${enabled ? accentColor : "rgba(255, 255, 255, 0.2)"}`,
          opacity: loading ? 0.5 : 1,
        }}
      >
        <div
          className="w-4 h-4 rounded-full transition-all duration-200"
          style={{
            backgroundColor: enabled ? accentColor : "rgba(255, 255, 255, 0.4)",
            marginLeft: enabled ? "calc(100% - 1.25rem)" : "0.25rem",
            boxShadow: enabled ? `0 0 6px ${accentColor}` : "none",
          }}
        />
      </button>
    </div>
  );
}

export function SettingsPanel() {
  const { t } = useTranslation();
  const { accentColor } = useThemeStore();
  const { currentUser, closeSettings, updatePrivacySetting, logoutFriendsAccount, updateFriendsProfile } = useFriendsStore();
  
  const customAvatarUrl = currentUser?.avatarUrl;
  const crafatarAvatar = useCrafatarAvatar({ uuid: currentUser?.uuid, size: 64 });
  const avatarUrl = customAvatarUrl || crafatarAvatar;

  const [loadingSettings, setLoadingSettings] = useState<Record<string, boolean>>({});
  
  // Profile editing state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync edits when user loads or updates
  useEffect(() => {
    if (currentUser) {
      setEditUsername(currentUser.username);
      setEditAvatarUrl(currentUser.avatarUrl || "");
    }
  }, [currentUser]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 200 * 1024) {
      setEditError("Image size must be less than 200KB");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setEditAvatarUrl(base64String);
      setEditError(null);
    };
    reader.onerror = () => {
      setEditError("Failed to read image file");
    };
    reader.readAsDataURL(file);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  if (!currentUser) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Icon
            icon="solar:refresh-linear"
            className="w-6 h-6 animate-spin"
            style={{ color: accentColor.value }}
          />
          <span className="text-white/60 text-xs">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  const status = getStatusConfig()[currentUser.state];

  const handleToggle = async (setting: string, currentValue: boolean) => {
    setLoadingSettings((prev) => ({ ...prev, [setting]: true }));
    try {
      await updatePrivacySetting(setting, !currentValue);
    } catch (e) {
      console.error("Failed to update privacy setting:", e);
    } finally {
      setLoadingSettings((prev) => ({ ...prev, [setting]: false }));
    }
  };

  const handleCancelEdit = () => {
    setEditUsername(currentUser.username);
    setEditAvatarUrl(currentUser.avatarUrl || "");
    setEditError(null);
    setIsEditingProfile(false);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setEditError(null);
    try {
      await updateFriendsProfile(editAvatarUrl);
      setIsEditingProfile(false);
      toast.success("Profile updated successfully!");
    } catch (err: any) {
      setEditError(err.message || String(err));
    } finally {
      setIsSaving(false);
    }
  };

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
          <span className="text-sm font-medium text-white font-minecraft-ten">{t('common.settings')}</span>
        </div>
        <button
          onClick={closeSettings}
          className="p-1.5 rounded-lg transition-all duration-200"
          style={{
            backgroundColor: `${accentColor.value}20`,
            color: accentColor.value,
          }}
        >
          <Icon icon="solar:close-circle-bold" className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        <div
          className="flex flex-col items-center p-5 rounded-xl"
          style={{
            backgroundColor: `${accentColor.value}15`,
            border: `1px solid ${accentColor.value}40`,
          }}
        >
          <div className="relative mb-3">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={currentUser.uuid}
                className="w-16 h-16 rounded-xl object-cover"
                style={{
                  border: `3px solid ${accentColor.value}60`,
                  boxShadow: `0 0 20px ${accentColor.value}30`,
                }}
              />
            ) : (
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center"
                style={{
                  backgroundColor: `${accentColor.value}30`,
                  border: `3px solid ${accentColor.value}60`,
                }}
              >
                <Icon
                  icon="solar:user-bold"
                  className="w-8 h-8"
                  style={{ color: accentColor.value }}
                />
              </div>
            )}
            <div
              className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2"
              style={{
                backgroundColor: status.color,
                boxShadow: status.glow,
                borderColor: `${accentColor.value}40`,
              }}
            />
          </div>
          <div className="text-center w-full">
            <div className="text-white font-minecraft-ten text-sm mb-1">{currentUser.username}</div>
            <div className="text-white/50 font-minecraft text-xs mb-3">{status.label}</div>
            
            <button
              onClick={() => {
                if (isEditingProfile) {
                  handleCancelEdit();
                } else {
                  setIsEditingProfile(true);
                }
              }}
              className="px-2.5 py-1 rounded-lg text-[10px] font-minecraft-ten transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] inline-flex items-center gap-1 cursor-pointer"
              style={{
                backgroundColor: `${accentColor.value}20`,
                border: `1px solid ${accentColor.value}40`,
                color: 'white'
              }}
            >
              <Icon icon={isEditingProfile ? "solar:close-circle-bold" : "solar:pen-bold"} className="w-3 h-3" />
              {isEditingProfile ? "Cancel" : "Edit Profile"}
            </button>
          </div>
        </div>

        {/* Edit Profile Form */}
        {isEditingProfile && (
          <form
            onSubmit={handleSaveProfile}
            className="p-4 rounded-xl space-y-3 transition-all duration-300"
            style={{
              backgroundColor: `${accentColor.value}10`,
              border: `1px solid ${accentColor.value}30`,
            }}
          >
            <div className="text-xs font-bold text-white uppercase tracking-wider font-minecraft-ten">
              Edit Profile Settings
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-minecraft-ten text-white/70 uppercase">Username</label>
              <div
                className="flex items-center gap-2 rounded-lg border px-3 py-1.5 opacity-60"
                style={{
                  backgroundColor: "rgba(0,0,0,0.3)",
                  borderColor: `${accentColor.value}20`
                }}
              >
                <input
                  type="text"
                  value={currentUser.username}
                  className="flex-1 bg-transparent text-white/70 font-minecraft text-sm focus:outline-none cursor-not-allowed"
                  disabled
                />
              </div>
              <span className="text-[9px] text-white/30 font-minecraft">
                Username cannot be changed.
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-minecraft-ten text-white/70 uppercase">Profile Picture (File)</label>
              <div className="flex flex-col items-center gap-3 p-3 rounded-lg border"
                style={{
                  backgroundColor: "rgba(0,0,0,0.2)",
                  borderColor: `${accentColor.value}35`
                }}
              >
                {editAvatarUrl ? (
                  <div className="relative group">
                    <img
                      src={editAvatarUrl}
                      alt="Avatar Preview"
                      className="w-16 h-16 rounded-xl object-cover"
                      style={{
                        border: `2px solid ${accentColor.value}`,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setEditAvatarUrl("")}
                      className="absolute -top-1 -right-1 p-0.5 rounded-full bg-red-500 hover:bg-red-600 text-white cursor-pointer"
                      title="Remove image"
                    >
                      <Icon icon="solar:close-circle-bold" className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div
                    className="w-16 h-16 rounded-xl flex items-center justify-center cursor-pointer"
                    style={{
                      backgroundColor: `${accentColor.value}20`,
                      border: `2px dashed ${accentColor.value}50`,
                    }}
                    onClick={handleUploadClick}
                  >
                    <Icon icon="solar:camera-bold" className="w-7 h-7" style={{ color: `${accentColor.value}60` }} />
                  </div>
                )}
                
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                  disabled={isSaving}
                />
                
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={handleUploadClick}
                    disabled={isSaving}
                    className="px-3 py-1.5 rounded-lg text-xs font-minecraft-ten bg-white/10 hover:bg-white/20 transition-colors border border-white/20 text-white cursor-pointer"
                  >
                    Choose Image File
                  </button>
                  <span className="text-[9px] text-white/40 font-minecraft">
                    PNG, JPG, or WebP. Max size: 200KB.
                  </span>
                </div>
              </div>
            </div>

            {editError && (
              <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg font-minecraft text-[11px] text-red-400 bg-red-500/10 border border-red-500/20">
                <Icon icon="solar:danger-circle-bold" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span className="break-words min-w-0">{editError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-white font-minecraft-ten text-xs font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              style={{
                backgroundColor: accentColor.value,
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? (
                <Icon icon="solar:refresh-linear" className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Icon icon="solar:check-circle-bold" className="w-3.5 h-3.5" />
              )}
              Save Changes
            </button>
          </form>
        )}

        <div className="space-y-2">
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider font-minecraft-ten px-1">
            {t('friends.settings.status')}
          </div>
          <StatusSelector currentStatus={currentUser.state} />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider font-minecraft-ten px-1">
            {t('friends.settings.privacy')}
          </div>
          <div className="space-y-2">
            <PrivacyToggle
              label={t('friends.settings.show_server')}
              description={t('friends.settings.show_server_desc')}
              enabled={currentUser.privacy.showServer}
              loading={loadingSettings.showServer || false}
              onToggle={() => handleToggle("showServer", currentUser.privacy.showServer)}
              accentColor={accentColor.value}
            />
            <PrivacyToggle
              label={t('friends.settings.allow_requests')}
              description={t('friends.settings.allow_requests_desc')}
              enabled={currentUser.privacy.allowRequests}
              loading={loadingSettings.allowRequests || false}
              onToggle={() => handleToggle("allowRequests", currentUser.privacy.allowRequests)}
              accentColor={accentColor.value}
            />
            <PrivacyToggle
              label={t('friends.settings.server_invites')}
              description={t('friends.settings.server_invites_desc')}
              enabled={currentUser.privacy.allowServerInvites}
              loading={loadingSettings.allowServerInvites || false}
              onToggle={() => handleToggle("allowServerInvites", currentUser.privacy.allowServerInvites)}
              accentColor={accentColor.value}
            />
          </div>
        </div>

        <div className="pt-2 border-t" style={{ borderColor: `${accentColor.value}30` }}>
          <button
            onClick={logoutFriendsAccount}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-white font-minecraft-ten text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#ef4444",
            }}
          >
            <Icon icon="solar:logout-bold" className="w-4 h-4" />
            Logout from Friends
          </button>
        </div>
      </div>
    </div>
  );
}
