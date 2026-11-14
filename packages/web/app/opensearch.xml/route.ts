import { appUrl } from "@/lib/server/env";
import { searchTemplate } from "@/lib/search-request";

export const dynamic = "force-dynamic";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** OpenSearch description, so browsers can offer Beamling as a search engine. */
export function GET() {
  const origin = appUrl();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Beamling</ShortName>
  <Description>Ask Beamling from the address bar</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="48" height="48" type="image/x-icon">${escape(origin)}/favicon.ico</Image>
  <Url type="text/html" method="get" template="${escape(searchTemplate(origin, "{searchTerms}"))}"/>
</OpenSearchDescription>
`;
  return new Response(xml, {
    headers: { "Content-Type": "application/opensearchdescription+xml; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
