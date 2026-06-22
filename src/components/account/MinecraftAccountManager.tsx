"use client";

import { Icon } from "@iconify/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import type { MinecraftAccount } from "../../types/minecraft";
import { DropdownHeader } from "../ui/dropdown/DropdownHeader";
import { DropdownFooter } from "../ui/dropdown/DropdownFooter";
import { DropdownDivider } from "../ui/dropdown/DropdownDivider";
import { StatusMessage } from "../ui/StatusMessage";
import { Input } from "../ui/Input";
import { useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { gsap } from "gsap";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { getLauncherConfig } from "../../services/launcher-config-service";
import { MinecraftAuthService } from "../../services/minecraft-auth-service";
import { toast } from "react-hot-toast";
import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import { EventType, type EventPayload } from "../../types/events";
import { cn } from "../../lib/utils";

interface MinecraftAccountManagerProps {
  onClose: () => void;
  isInDropdown?: boolean;
}

export function MinecraftAccountManager({
  onClose,
  isInDropdown,
}: MinecraftAccountManagerProps) {
  const {
    accounts,
    isLoading,
    error,
    addAccount,
    removeAccount,
    setActiveAccount,
    addOfflineAccount,
    editOfflineAccount,
  } = useMinecraftAuthStore();
  const { showModal, hideModal } = useGlobalModal();
  const { t } = useTranslation();
  const [useBrowserLogin, setUseBrowserLogin] = useState(true);

  // Rebranding offline UI states
  const [view, setView] = useState<"list" | "choice" | "add-offline" | "edit-offline" | "browser-login">("list");
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [editingAccount, setEditingAccount] = useState<MinecraftAccount | null>(null);

  useEffect(() => {
    getLauncherConfig()
      .then((config) => {
        setUseBrowserLogin(config.use_browser_based_login);
      })
      .catch((err) => {
        console.error("Failed to load launcher configuration:", err);
      });
  }, []);

  const handleAddAccountMicrosoft = async () => {
    setView("browser-login");
    try {
      await addAccount();
      setView("list");
    } catch (err) {
      console.error("Failed to add account:", err);
      setView("list");
    }
  };

  const handleCancelBrowserLogin = async () => {
    try {
      await MinecraftAuthService.cancelLogin();
      setView("list");
    } catch (err) {
      console.error("Failed to cancel login:", err);
      setView("list");
    }
  };

  const validateUsername = (name: string): boolean => {
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 16) {
      setUsernameError("username must be between 3 and 16 characters.");
      return false;
    }
    const re = /^[a-zA-Z0-9_]+$/;
    if (!re.test(trimmed)) {
      setUsernameError("username can only contain letters, numbers, and underscores.");
      return false;
    }
    setUsernameError("");
    return true;
  };

  const handleAddOfflineAccountSubmit = async () => {
    if (!validateUsername(usernameInput)) return;
    try {
      await addOfflineAccount(usernameInput);
      setUsernameInput("");
      setView("list");
    } catch (err: any) {
      console.error("Failed to add offline account:", err);
      setUsernameError(err.message || String(err));
    }
  };

  const handleEditOfflineAccountSubmit = async () => {
    if (!editingAccount || !validateUsername(usernameInput)) return;
    try {
      await editOfflineAccount(editingAccount.id, usernameInput);
      setUsernameInput("");
      setEditingAccount(null);
      setView("list");
    } catch (err: any) {
      console.error("Failed to edit offline account:", err);
      setUsernameError(err.message || String(err));
    }
  };

  const handleSetActive = async (accountId: string) => {
    try {
      await setActiveAccount(accountId);
    } catch (err) {
      console.error("Error setting active account:", err);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    try {
      await removeAccount(accountId);
    } catch (err) {
      console.error("Error removing account:", err);
    }
  };

  const handleEditTrigger = (account: MinecraftAccount) => {
    setEditingAccount(account);
    setUsernameInput(account.minecraft_username || account.username);
    setUsernameError("");
    setView("edit-offline");
  };



  const renderContent = () => {
    if (view === "choice") {
      return (
        <div className={cn("p-4 flex flex-col items-center gap-4", isInDropdown ? "w-64" : "p-6")}>
          <h3 className="text-2xl text-white font-minecraft lowercase select-none">
            select login type
          </h3>
          <div className={cn("flex w-full gap-4", isInDropdown ? "flex-col" : "flex-row")}>
            <button
              onClick={handleAddAccountMicrosoft}
              disabled={isLoading}
              className={cn(
                "flex bg-black/40 hover:bg-white/5 border border-white/10 hover:border-white/20 transition-all rounded-md group text-center",
                isInDropdown
                  ? "flex-row items-center justify-start px-4 py-3 gap-4 w-full"
                  : "flex-col items-center justify-center p-6 gap-3"
              )}
            >
              <Icon
                icon="logos:microsoft-icon"
                className={cn("transition-transform group-hover:scale-110", isInDropdown ? "w-6 h-6" : "w-12 h-12")}
              />
              <span className={cn("text-white font-minecraft lowercase", isInDropdown ? "text-lg" : "text-xl")}>
                minecraft account (microsoft)
              </span>
            </button>
            <button
              onClick={() => {
                setUsernameInput("");
                setUsernameError("");
                setView("add-offline");
              }}
              disabled={isLoading}
              className={cn(
                "flex bg-black/40 hover:bg-white/5 border border-white/10 hover:border-white/20 transition-all rounded-md group text-center",
                isInDropdown
                  ? "flex-row items-center justify-start px-4 py-3 gap-4 w-full"
                  : "flex-col items-center justify-center p-6 gap-3"
              )}
            >
              <Icon
                icon="solar:user-bold"
                className={cn("text-blue-400 transition-transform group-hover:scale-110", isInDropdown ? "w-6 h-6" : "w-12 h-12")}
              />
              <span className={cn("text-white font-minecraft lowercase", isInDropdown ? "text-lg" : "text-xl")}>
                offline account
              </span>
            </button>
          </div>
          <div className="flex justify-start w-full">
            <Button
              variant="default"
              onClick={() => setView("list")}
              size={isInDropdown ? "sm" : "md"}
              icon={<Icon icon="solar:arrow-left-linear" className="w-4 h-4" />}
              className="w-full flex-row"
            >
              back
            </Button>
          </div>
        </div>
      );
    }

    if (view === "browser-login") {
      return <BrowserLoginModal onCancel={handleCancelBrowserLogin} />;
    }

    if (view === "add-offline" || view === "edit-offline") {
      const isEdit = view === "edit-offline";
      return (
        <div className="p-4 space-y-4">
          <h3 className="text-2xl text-white font-minecraft lowercase select-none">
            {isEdit ? "edit offline account" : "create offline account"}
          </h3>
          <div className="space-y-2">
            <label className="text-xl text-white/70 font-minecraft lowercase">username</label>
            <Input
              value={usernameInput}
              onChange={(e) => {
                setUsernameInput(e.target.value);
                if (usernameError) validateUsername(e.target.value);
              }}
              placeholder="Username (e.g. Steve)"
              error={usernameError}
              icon={<Icon icon="solar:user-linear" className="w-5 h-5 text-white/50" />}
              autoFocus
            />
            <p className="text-sm text-white/50 font-minecraft-ten">
              username must be 3-16 characters and contain only letters, numbers, and underscores.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="default" onClick={() => setView("list")} size="md">
              cancel
            </Button>
            <Button
              variant="success"
              onClick={isEdit ? handleEditOfflineAccountSubmit : handleAddOfflineAccountSubmit}
              disabled={isLoading}
              size="md"
            >
              {isLoading ? (
                <>
                  <Icon icon="solar:spinner-bold" className="w-4 h-4 animate-spin mr-1" />
                  saving...
                </>
              ) : isEdit ? (
                isInDropdown ? "save" : "update username"
              ) : (
                isInDropdown ? "add account" : "add offline account"
              )}
            </Button>
          </div>
        </div>
      );
    }

    // List view
    return (
      <div className="p-6">
        {error && <StatusMessage type="error" message={error} />}

        <div className="space-y-6">
          <div>
            <h3 className="text-2xl font-minecraft text-white mb-5 lowercase select-none">
              {t("auth.manageAccounts")}
            </h3>
            <p className="text-xl text-white/70 mb-6 font-minecraft tracking-wide select-none">
              {t("auth.manageAccountsDescription")}
            </p>
          </div>

          <div className="bg-black/30 backdrop-blur-md border-2 border-white/20 p-5 rounded-md">
            <h3 className="text-2xl text-white font-medium mb-3 select-none">
              {t("auth.yourAccounts")}
            </h3>

            <div className="space-y-3 max-h-[40vh] overflow-y-auto custom-scrollbar">
              {isLoading && accounts.length === 0 ? (
                <div className="py-4 text-center">
                  <Icon
                    icon="solar:spinner-bold"
                    className="w-8 h-8 animate-spin mx-auto text-white/70"
                  />
                  <p className="mt-2 text-white/70 text-xl">
                    {t("auth.loadingAccounts")}
                  </p>
                </div>
              ) : accounts.length === 0 ? (
                <div className="py-6 text-center">
                  <Icon
                    icon="solar:user-cross-bold"
                    className="w-12 h-12 mx-auto text-white/50 mb-3"
                  />
                  <p className="text-white/70 text-xl">{t("auth.noAccountsFound")}</p>
                  <p className="mt-1 text-white/50 text-lg">
                    {t("auth.addAccountToGetStarted")}
                  </p>
                </div>
              ) : (
                accounts.map((account) => (
                  <AccountItem
                    key={account.id}
                    account={account}
                    onSetActive={handleSetActive}
                    onRemoveAccount={handleRemoveAccount}
                    onEditAccount={handleEditTrigger}
                    isLoading={isLoading}
                  />
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="success"
              onClick={() => setView("choice")}
              disabled={isLoading}
              icon={<Icon icon="solar:add-circle-bold" className="w-5 h-5" />}
              size="lg"
            >
              {t("auth.addMinecraftAccount")}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  if (isInDropdown) {
    if (view !== "list") {
      return (
        <div className="flex flex-col max-h-[400px] bg-black/95 backdrop-blur-xl border border-white/10 rounded-md overflow-hidden">
          {renderContent()}
        </div>
      );
    }
    return (
      <div className="flex flex-col max-h-[400px]">
        <DropdownHeader title={t("auth.minecraftAccounts")}>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors"
          >
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </DropdownHeader>

        <div className="overflow-y-auto custom-scrollbar max-h-[300px]">
          {isLoading && accounts.length === 0 ? (
            <div className="py-3 px-3 text-center">
              <Icon
                icon="solar:spinner-bold"
                className="w-5 h-5 animate-spin mx-auto text-white/70"
              />
              <p className="mt-1 text-white/70 text-sm font-minecraft-ten">{t("auth.loadingAccounts")}</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="py-4 px-3 text-center">
              <Icon
                icon="solar:user-cross-bold"
                className="w-6 h-6 mx-auto text-white/50 mb-1"
              />
              <p className="text-white/70 text-sm font-minecraft-ten">{t("auth.noAccountsFound")}</p>
              <p className="mt-1 text-white/50 text-[0.6em] font-minecraft-ten">
                {t("auth.addAccountToGetStarted")}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {accounts.map((account) => (
                <AccountItem
                  key={account.id}
                  account={account}
                  onSetActive={handleSetActive}
                  onRemoveAccount={handleRemoveAccount}
                  onEditAccount={handleEditTrigger}
                  isLoading={isLoading}
                  isDropdownItem
                />
              ))}
            </div>
          )}
        </div>

        <DropdownDivider />

        <DropdownFooter>
          <Button
            variant="default"
            onClick={() => setView("choice")}
            disabled={isLoading}
            icon={<Icon icon="solar:add-circle-bold" className="w-3 h-3" />}
            size="sm"
            className="w-full"
          >
            {t("auth.addAccount")}
          </Button>
        </DropdownFooter>
      </div>
    );
  }

  return (
    <Modal title={t("auth.accountManager")} onClose={onClose} width="lg">
      <div className="overflow-hidden min-h-[300px]">
        {renderContent()}
      </div>
    </Modal>
  );
}

interface AccountItemProps {
  account: MinecraftAccount;
  onSetActive: (accountId: string) => Promise<void>;
  onRemoveAccount: (accountId: string) => Promise<void>;
  onEditAccount?: (account: MinecraftAccount) => void;
  isLoading: boolean;
  isDropdownItem?: boolean;
}

function AccountItem({
  account,
  onSetActive,
  onRemoveAccount,
  onEditAccount,
  isLoading,
  isDropdownItem,
}: AccountItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const { t } = useTranslation();
  
  const avatarSizePx = isDropdownItem ? 32 : 40;
  
  // Custom offline accounts use standard avatar but bypass live crafatar if desired, 
  // or resolve it if crafatar supports offline names. Since it's offline, we resolve avatarUrl safely
  const avatarUrl = useCrafatarAvatar({
    uuid: account.id,
    size: avatarSizePx,
    overlay: true,
  });

  const handleAccountClick = () => {
    if (
      account.active ||
      isLoading ||
      isActivating ||
      isRemoving ||
      !itemRef.current
    )
      return;

    setIsActivating(true);
    gsap.to(itemRef.current, {
      scale: 0.97,
      duration: 0.1,
      yoyo: true,
      repeat: 1,
      ease: "power1.inOut",
      onComplete: () => {
        gsap.set(itemRef.current, { scale: 1 });
        const performSetActive = async () => {
          try {
            await onSetActive(account.id);
          } catch (err) {
            console.error("Error setting account active:", err);
          } finally {
            setIsActivating(false);
          }
        };
        performSetActive();
      },
    });
  };

  const handleRemoveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLoading || isActivating || isRemoving) return;

    setIsRemoving(true);
    try {
      await onRemoveAccount(account.id);
    } catch (err) {
      console.error("Error removing account:", err);
      setIsRemoving(false);
    }
  };

  const effectiveIsLoading = isLoading || isActivating || isRemoving;

  return (
    <div
      ref={itemRef}
      className={`flex items-center justify-between rounded-md ${
        account.active ? "bg-white/10" : "bg-black/40 hover:bg-white/5"
      } border border-white/10 hover:border-white/20 transition-colors overflow-hidden ${
        isDropdownItem ? "p-2" : "p-3"
      } ${
        !account.active && !effectiveIsLoading
          ? "cursor-pointer"
          : "cursor-default"
      } ${isActivating ? "opacity-75" : ""}`}
      onClick={!account.active ? handleAccountClick : undefined}
    >
      <div className="flex items-center gap-2 min-w-0 flex-grow">
        <div
          className="relative overflow-hidden border border-white/20 flex items-center justify-center bg-black/50 flex-shrink-0 rounded-sm"
          style={{
            width: isDropdownItem ? "32px" : "40px",
            height: isDropdownItem ? "32px" : "40px",
          }}
        >
          {account.auth_flow !== "Offline" && avatarUrl ? (
            <img
              src={avatarUrl || "/placeholder.svg"}
              alt={`${account.minecraft_username || account.username}'s avatar`}
              className="pixelated"
              style={{
                width: `${avatarSizePx}px`,
                height: `${avatarSizePx}px`,
                objectFit: "cover",
                display: "block",
                imageRendering: "pixelated" as const,
              }}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = "none";
              }}
            />
          ) : (
            // Custom offline avatar with user icon or initial
            <Icon icon="solar:user-linear" className={isDropdownItem ? "w-5 h-5 text-white/50" : "w-6 h-6 text-white/50"} />
          )}
        </div>
        <div className="min-w-0 flex-1 flex items-center">
          <h4
            className={cn("text-white font-minecraft truncate translate-y-[2px] flex-shrink", isDropdownItem ? "text-lg" : "text-2xl")}
            title={account.minecraft_username || account.username}
          >
            {account.minecraft_username || account.username}
          </h4>
          {account.auth_flow === "Offline" ? (
            <span className="flex-shrink-0 ml-2 text-xs font-minecraft-ten text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded-sm lowercase translate-y-[2px]">
              offline
            </span>
          ) : (
            <span className="flex-shrink-0 ml-2 text-xs font-minecraft-ten text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded-sm lowercase translate-y-[2px]">
              premium
            </span>
          )}
          {isActivating && (
            <Icon
              icon="solar:spinner-bold"
              className={`animate-spin ${isDropdownItem ? "w-4 h-4" : "w-5 h-5"} text-white/80 ml-2`}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {account.auth_flow === "Offline" && onEditAccount && (
          isDropdownItem ? (
            <IconButton
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onEditAccount(account);
              }}
              disabled={effectiveIsLoading}
              shadowDepth="short"
              icon={<Icon icon="solar:pen-bold" className="w-3 h-3 text-white/70" />}
              size="xs"
              aria-label="Edit Username"
            />
          ) : (
            <Button
              variant="default"
              onClick={(e) => {
                e.stopPropagation();
                onEditAccount(account);
              }}
              disabled={effectiveIsLoading}
              size="md"
              aria-label="Edit Username"
              className="mr-1"
            >
              <Icon icon="solar:pen-bold" className="w-5 h-5" />
              <span className="ml-1">edit</span>
            </Button>
          )
        )}
        {isDropdownItem ? (
          <IconButton
            variant="ghost"
            onClick={handleRemoveClick}
            disabled={effectiveIsLoading}
            shadowDepth="short"
            icon={
              isRemoving ? (
                <Icon
                  icon="solar:spinner-bold"
                  className="w-3 h-3 animate-spin"
                />
              ) : (
                <Icon icon="solar:trash-bin-trash-bold" className="w-3 h-3 text-red-400/80" />
              )
            }
            size="xs"
            aria-label={t("auth.removeAccount")}
          />
        ) : (
          <Button
            variant="destructive"
            onClick={handleRemoveClick}
            disabled={effectiveIsLoading}
            size="md"
            aria-label={t("auth.removeAccount")}
          >
            {isRemoving ? (
              <>
                <Icon
                  icon="solar:spinner-bold"
                  className="w-5 h-5 animate-spin"
                />
                <span className="ml-2">{t("auth.removing")}</span>
              </>
            ) : (
              <>
                <Icon icon="solar:trash-bin-trash-bold" className="w-5 h-5" />
                <span className="ml-1">{t("auth.remove")}</span>
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

interface BrowserLoginModalProps {
  onCancel: () => Promise<void>;
}

function BrowserLoginModal({ onCancel }: BrowserLoginModalProps) {
  const { t } = useTranslation();
  const [loginStatus, setLoginStatus] = useState<string>(t("auth.startingLoginProcess"));
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<EventPayload>("state_event", (event: TauriEvent<EventPayload>) => {
      const payload = event.payload;
      
      if (payload.event_type === EventType.Error && payload.error) {
        setError(payload.error);
        setLoginStatus(payload.message);
        return;
      }
      
      if (
        payload.event_type === EventType.AccountLoginStarted ||
        payload.event_type === EventType.AccountLoginWaitingForBrowser ||
        payload.event_type === EventType.AccountLoginExchangingToken ||
        payload.event_type === EventType.AccountLoginExchangingXboxToken ||
        payload.event_type === EventType.AccountLoginExchangingXstsToken ||
        payload.event_type === EventType.AccountLoginGettingMinecraftToken ||
        payload.event_type === EventType.AccountLoginCheckingEntitlements ||
        payload.event_type === EventType.AccountLoginFetchingProfile ||
        payload.event_type === EventType.AccountLoginCompleted
      ) {
        setError(null);
        setLoginStatus(payload.message);
        if (payload.progress !== null) {
          setProgress(payload.progress);
        }
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <Modal
      title={t("auth.browserLogin")}
      onClose={async () => {
        await onCancel();
      }}
      width="md"
    >
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <Icon icon="solar:global-bold" className="w-8 h-8 text-white" />
          <div>
            <h3 className="text-2xl font-minecraft text-white lowercase">
              {t("auth.signInViaBrowser")}
            </h3>
            <p className="text-sm text-white/70 font-minecraft-ten mt-1">
              {t("auth.browserLoginDescription")}
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 backdrop-blur-md border border-red-500/40 p-4 rounded-md">
            <div className="flex items-start gap-2">
              <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-200 font-minecraft-ten">
                <p className="font-semibold mb-1">{t("auth.loginError")}</p>
                <p className="text-red-300">{error}</p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className={`font-minecraft-ten ${error ? "text-red-300" : "text-white/80"}`}>
              {loginStatus}
            </span>
            {!error && (
              <span className="text-white/60 font-minecraft-ten">{Math.round(progress)}%</span>
            )}
          </div>
          {!error && (
            <div className="w-full bg-black/40 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button
            variant="destructive"
            onClick={onCancel}
            icon={<Icon icon="solar:close-circle-bold" className="w-5 h-5" />}
            size="md"
          >
            {t("auth.cancelLogin")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

