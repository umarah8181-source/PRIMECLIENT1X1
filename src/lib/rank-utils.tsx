import { useFriendsStore } from "../store/friends-store";

export function renderRankBadge(username: string) {
  if (!username) return null;
  const ranks = useFriendsStore.getState().ranks || {};
  const rank = ranks[username.toLowerCase()];
  if (!rank) return null;

  let badgeColor = "";
  let badgeText = "";
  let borderColor = "";
  let glowColor = "";

  switch (rank.toLowerCase()) {
    case "owner":
      badgeColor = "rgba(239, 68, 68, 0.2)"; // glowing red
      badgeText = "OWNER";
      borderColor = "#ef4444";
      glowColor = "rgba(239, 68, 68, 0.5)";
      break;
    case "admin":
      badgeColor = "rgba(249, 115, 22, 0.2)"; // orange
      badgeText = "ADMIN";
      borderColor = "#f97316";
      glowColor = "rgba(249, 115, 22, 0.5)";
      break;
    case "developer":
    case "dev":
      badgeColor = "rgba(168, 85, 247, 0.2)"; // purple
      badgeText = "DEV";
      borderColor = "#a855f7";
      glowColor = "rgba(168, 85, 247, 0.5)";
      break;
    case "member":
      badgeColor = "rgba(59, 130, 246, 0.2)"; // blue
      badgeText = "MEMBER";
      borderColor = "#3b82f6";
      glowColor = "rgba(59, 130, 246, 0.5)";
      break;
    default:
      badgeColor = "rgba(107, 114, 128, 0.2)"; // gray
      badgeText = rank.toUpperCase();
      borderColor = "#6b7280";
      glowColor = "none";
  }

  return (
    <span
      className="px-1.5 py-0.5 rounded text-[9px] font-minecraft-ten border uppercase flex-shrink-0"
      style={{
        backgroundColor: badgeColor,
        borderColor: borderColor,
        color: borderColor,
        textShadow: glowColor !== "none" ? `0 0 4px ${glowColor}` : "none",
        boxShadow: glowColor !== "none" ? `0 0 6px ${glowColor}` : "none",
        letterSpacing: "0.05em",
        fontWeight: "bold",
        lineHeight: 1,
        display: "inline-block"
      }}
    >
      {badgeText}
    </span>
  );
}
