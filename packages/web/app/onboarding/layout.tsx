import { StoreProvider } from "@/lib/store";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <StoreProvider>{children}</StoreProvider>;
}
