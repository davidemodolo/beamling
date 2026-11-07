import Link from "next/link";
import { Mascot } from "@/components/mascot";

export default function NotFound() {
  return (
    <main className="notfound">
      <div>
        <div className="mascot" aria-hidden="true">
          <Mascot expression="confused" beams={false} label="" style={{ width: 260 }} />
        </div>
        <h1>Nothing is lit here</h1>
        <p>The page you are looking for does not exist, or it moved.</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 22 }}>
          <Link href="/" className="btn btn-primary">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
