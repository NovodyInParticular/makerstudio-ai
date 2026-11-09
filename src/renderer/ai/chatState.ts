// In-app chat in the window: the visible conversation. The model runs in the main process
// (chat.ts); its text and tool activity arrive as events.

import { create } from "zustand";
import type { ChatEvent } from "../../shared/ipc";
import { newId } from "../../shared/format";
import { useAi } from "./aiState";

export interface ChatTool { name: string; ok: boolean; detail: string }
export interface ChatMessage { id: string; role: "user" | "assistant"; text: string; tools: ChatTool[]; error?: string; image?: string }

interface ChatState {
  chatId: string;
  messages: ChatMessage[];
  busy: boolean;
}

export const useChat = create<ChatState>()(() => ({ chatId: newId(), messages: [], busy: false }));

function updateLast(fn: (m: ChatMessage) => ChatMessage) {
  const msgs = useChat.getState().messages;
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "assistant") return;
  useChat.setState({ messages: [...msgs.slice(0, -1), fn(last)] });
}

export function onChatEvent(e: ChatEvent) {
  if (e.chatId !== useChat.getState().chatId) return;
  if (e.type === "text") updateLast((m) => ({ ...m, text: m.text + e.delta }));
  else if (e.type === "tool") updateLast((m) => ({ ...m, tools: [...m.tools, { name: e.name, ok: e.ok, detail: e.detail }] }));
  else if (e.type === "error") { updateLast((m) => ({ ...m, error: e.message })); useChat.setState({ busy: false }); }
  else useChat.setState({ busy: false });
}

export function sendChat(text: string, image?: { token: string; preview: string }) {
  const t = text.trim() || (image ? "Make this." : "");
  const s = useChat.getState();
  if (!t || s.busy) return;
  useChat.setState({
    busy: true,
    messages: [...s.messages, { id: newId(), role: "user", text: t, tools: [], ...(image ? { image: image.preview } : {}) }, { id: newId(), role: "assistant", text: "", tools: [] }],
  });
  void window.makerstudio.chatSend(s.chatId, t, useAi.getState().mode, image?.token);
}

export function stopChat() {
  window.makerstudio.chatCancel(useChat.getState().chatId);
}

export function newChat() {
  window.makerstudio.chatForget(useChat.getState().chatId);
  useChat.setState({ chatId: newId(), messages: [], busy: false });
}

let installed = false;
export function installChat() {
  if (installed) return;
  installed = true;
  window.makerstudio.onChatEvent(onChatEvent);
}
