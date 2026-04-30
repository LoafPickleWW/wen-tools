import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

interface ChatBubbleProps {
  isActive: boolean;
  unreadCount?: number;
}

export function ChatBubble({ isActive, unreadCount = 0 }: ChatBubbleProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (unreadCount > 0) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1000);
      return () => clearTimeout(t);
    }
  }, [unreadCount]);

  // Don't show on the chat page itself
  if (location.pathname === "/p2p-chat") return null;
  if (!isActive) return null;

  return (
    <button
      onClick={() => navigate("/p2p-chat")}
      className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full
        bg-gradient-to-r from-primary-orange to-[#e06b10]
        shadow-lg shadow-primary-orange/30 flex items-center justify-center
        hover:scale-110 transition-transform duration-200
        ${pulse ? "animate-bounce" : ""}`}
      title="Active P2P Chat"
    >
      <span className="text-2xl">💬</span>
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500
          text-white text-xs flex items-center justify-center font-bold">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );
}
