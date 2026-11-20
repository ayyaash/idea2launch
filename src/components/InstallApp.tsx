import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, MoreVertical } from "lucide-react";
import { Button, Modal, cx } from "./ui";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// The browser fires this once, often before React mounts, so catch it at load time.
let saved: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    saved = e as InstallPromptEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener("appinstalled", () => { saved = null; listeners.forEach((f) => f()); });
}

const isInstalled = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** "Install app" button: uses the browser's install prompt where there is one, otherwise shows the steps. */
export function InstallApp({ className, dark }: { className?: string; dark?: boolean }) {
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  if (isInstalled()) return null;

  async function install() {
    if (saved) {
      await saved.prompt();
      await saved.userChoice;
      saved = null;
      force((n) => n + 1);
    } else {
      setHelp(true);
    }
  }

  return (
    <>
      <button onClick={install}
        className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
          dark ? "text-navy-200 hover:bg-white/5 hover:text-white" : "text-brand-700 hover:bg-brand-50", className)}>
        <Download className="size-[18px]" /> Install app
      </button>
      <Modal open={help} onClose={() => setHelp(false)} title="Install Idea2Launch"
        footer={<Button variant="primary" onClick={() => setHelp(false)}>Got it</Button>}>
        {isIos() ? (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Open this site in <b>Safari</b>.</li>
            <li>Tap the <b>Share</b> button <Share className="inline size-4 align-text-bottom" />.</li>
            <li>Tap <b>Add to Home Screen</b> <SquarePlus className="inline size-4 align-text-bottom" />, then <b>Add</b>.</li>
          </ol>
        ) : (
          <div className="space-y-3 text-sm text-slate-700">
            <p><b>On a PC (Chrome or Edge):</b> click the install icon at the right end of the address bar, or open the browser menu and choose <b>Install Idea2Launch</b> (in Edge: <b>Apps → Install this site as an app</b>).</p>
            <p><b>On Android (Chrome):</b> tap the menu <MoreVertical className="inline size-4 align-text-bottom" /> and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>
            <p className="text-slate-500">Firefox on a PC can't install apps. Use Chrome or Edge for that.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
