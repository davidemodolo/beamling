import type { Metadata } from "next";
import { ChatView } from "@/components/chat-view";

export const metadata: Metadata = { title: "New question" };

export default function ChatPage() {
  return <ChatView />;
}
