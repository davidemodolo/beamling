"use client";

import { useEffect } from "react";
import { stashSearchRequest } from "@/lib/search-request";

/** Signed out on /search: keeps the question in this tab and goes to sign in. */
export function SearchSignIn() {
  useEffect(() => {
    stashSearchRequest();
    window.location.replace("/login?next=%2Fsearch");
  }, []);
  return null;
}
