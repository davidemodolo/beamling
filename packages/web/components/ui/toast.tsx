"use client";

import { useEffect, useRef } from "react";
import { Icon, type IconName } from "./icon";

export function Toast({ message, onDone, icon = "check-circle" }: { message: string; onDone: () => void; icon?: IconName }) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const timer = window.setTimeout(() => done.current(), 2200);
    return () => window.clearTimeout(timer);
  }, [message]);
  return (
    <div className="toast" role="status">
      <Icon name={icon} size={15} />
      {message}
    </div>
  );
}
