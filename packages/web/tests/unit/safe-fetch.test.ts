import assert from "node:assert/strict";
import { test } from "node:test";
import { sniffImageType } from "../../lib/server/image-type";
import { normalizedImageUrl } from "../../lib/server/providers/shared";
import { fetchAnswerImage, isPublicAddress, SafeFetchError } from "../../lib/server/safe-fetch";

test("only public unicast addresses pass", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe",
    "2001:db8::1",
    "not an ip",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["93.184.215.14", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("the fetcher refuses non-https, other ports, credentials and private hosts before connecting", async () => {
  for (const url of [
    "http://example.org/a.png",
    "https://example.org:8443/a.png",
    "https://user:pass@example.org/a.png",
    "https://127.0.0.1/a.png",
    "https://[::1]/a.png",
    "https://[::ffff:169.254.169.254]/a.png",
    "https://localhost/a.png",
    "https://metadata.google.internal/a.png",
    "ftp://example.org/a.png",
  ]) {
    await assert.rejects(() => fetchAnswerImage(url), SafeFetchError, url);
  }
});

test("result pictures are kept only as plain https URLs", () => {
  assert.equal(normalizedImageUrl("https://imgs.example.org/a.jpg"), "https://imgs.example.org/a.jpg");
  for (const value of ["http://imgs.example.org/a.jpg", "https://u:p@imgs.example.org/a.jpg", "https://imgs.example.org:81/a.jpg", "data:image/png;base64,AA", 42, `https://e.org/${"a".repeat(2050)}`]) {
    assert.equal(normalizedImageUrl(value), undefined, String(value).slice(0, 40));
  }
});

test("picture bytes must be a raster type: never SVG or HTML", () => {
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(Buffer.from("GIF89a....")), "image/gif");
  assert.equal(sniffImageType(Buffer.from("\0\0\0\x1cftypavif", "latin1")), "image/avif");
  assert.equal(sniffImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1")), "image/webp");
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
  assert.equal(sniffImageType(Buffer.from("<!doctype html><img src=x onerror=alert(1)>")), null);
});
