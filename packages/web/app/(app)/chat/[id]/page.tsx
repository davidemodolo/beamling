import type { Metadata } from "next";
import { ChatView } from "@/components/chat-view";
import { requirePageUser } from "@/lib/server/page-auth";

export const metadata: Metadata = { title: "Conversation", robots: { index: false, follow: false } };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageUser(`/chat/${id}`);
  return <ChatView conversationId={id} />;
}
