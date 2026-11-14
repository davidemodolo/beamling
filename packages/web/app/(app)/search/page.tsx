import type { Metadata } from "next";
import { headers } from "next/headers";
import { ChatView } from "@/components/chat-view";
import { SearchSignIn } from "@/components/search-sign-in";
import { pageUser } from "@/lib/server/page-auth";
import { mayAutoSend } from "@/lib/search-request";

export const metadata: Metadata = { title: "New question", robots: { index: false, follow: false } };

/**
 * The address-bar entry point: `/search#q=…`. The question is in the fragment, so this request does
 * not carry it; the page only decides whether the browser may send it without a click.
 */
export default async function SearchPage() {
  if (!(await pageUser())) return <SearchSignIn />;
  const auto = mayAutoSend((await headers()).get("sec-fetch-site"));
  return <ChatView search={{ auto }} />;
}
