import { redirect } from "next/navigation";

/** The app lives at `/`; old links to /chat land there. */
export default function ChatPage() {
  redirect("/");
}
