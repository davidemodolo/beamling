import Link from "next/link";
import { Mascot } from "./mascot";

export function Wordmark({
  href = "/",
  className,
  onClick,
}: {
  href?: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Link href={href} className={`wordmark ${className ?? ""}`} aria-label="Beamling home" onClick={onClick}>
      <span className="wordmark-mark" aria-hidden="true">
        <Mascot expression="curious" beams={false} label="" style={{ width: 26 }} />
      </span>
      <span>Beamling</span>
    </Link>
  );
}
