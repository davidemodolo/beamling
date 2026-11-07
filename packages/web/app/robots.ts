import type { MetadataRoute } from "next";

/** Guest workspaces are private: only the public pages are indexable. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/chat/", "/onboarding", "/api/"] },
  };
}
