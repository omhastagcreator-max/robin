import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ExternalLink, X, Copy, Check } from 'lucide-react';

/**
 * Shown when WebRTC ICE/connection state fails — almost always because the
 * user's network blocks our public TURN server. Walks them through the
 * one-time free setup (Metered / Cloudflare) so the huddle works.
 */
export function TurnSetupBanner({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={`rounded-xl border border-amber-500/40 bg-amber-500/10 ${compact ? 'p-2' : 'p-3'}`}>
        <div className="flex items-start gap-2">
          <AlertTriangle className={`text-amber-500 shrink-0 mt-0.5 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
          <div className="flex-1 min-w-0">
            <p className={`font-semibold text-amber-700 dark:text-amber-400 ${compact ? 'text-[11px]' : 'text-xs'}`}>
              Voice connection blocked by your network
            </p>
            <p className={`text-amber-700/80 dark:text-amber-400/80 ${compact ? 'text-[10px] leading-tight' : 'text-[11px]'}`}>
              The huddle needs a TURN server. We're using a free public one but it's unreliable.
              Set up your own free TURN — takes 5 minutes, works forever.
            </p>
            <button
              onClick={() => setOpen(true)}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline"
            >
              Open setup guide <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {open && <SetupGuideModal onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

function SetupGuideModal({ onClose }: { onClose: () => void }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }}
        transition={{ duration: 0.18 }}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[min(640px,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl"
      >
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-base flex-1">Set up free unlimited TURN — 5 minutes</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 text-sm">
          <p className="text-muted-foreground">
            The voice call uses WebRTC, which needs a TURN server when peers are behind firewalls or
            NAT (most networks). The default public TURN is unreliable — pick one of the free options
            below for production-grade reliability.
          </p>

          <Section
            title="Option A — Metered.ca (recommended, easiest)"
            steps={[
              { text: 'Sign up at https://www.metered.ca/sign-up — no card needed.', href: 'https://www.metered.ca/sign-up?country=in' },
              { text: 'Dashboard → TURN Server → copy your username, password, and TURN URL.' },
              { text: 'Add three env vars in Vercel (Settings → Environment Variables → Production):' },
            ]}
            envBlock={`VITE_TURN_URL=turns:standard.relay.metered.ca:443
VITE_TURN_USERNAME=<your-username>
VITE_TURN_CREDENTIAL=<your-password>`}
            footer="Free tier: 0.5 GB / month — about 150 hours of audio mesh. Forever free."
          />

          <Section
            title="Option B — Cloudflare Calls (most generous)"
            steps={[
              { text: 'Sign up at https://dash.cloudflare.com — Calls → Create app.', href: 'https://dash.cloudflare.com' },
              { text: 'Generate TURN credentials from the Calls dashboard.' },
              { text: 'Same three env vars in Vercel:' },
            ]}
            envBlock={`VITE_TURN_URL=<URL Cloudflare gives you>
VITE_TURN_USERNAME=<turn key id>
VITE_TURN_CREDENTIAL=<turn key secret>`}
            footer="Free tier: 1 TB / month. Effectively unlimited for audio."
          />

          <div className="border-t border-border pt-4 text-[11px] text-muted-foreground">
            After setting the env vars, hit "Redeploy" on the latest production deploy in Vercel.
            The huddle will use your TURN automatically — no code change needed.
          </div>
        </div>
      </motion.div>
    </>
  );
}

function Section({ title, steps, envBlock, footer }: {
  title: string;
  steps: { text: string; href?: string }[];
  envBlock: string;
  footer: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      <p className="font-semibold text-sm">{title}</p>
      <ol className="space-y-1.5 text-xs text-foreground list-decimal list-inside">
        {steps.map((s, i) => (
          <li key={i}>
            {s.href ? (
              <>
                {s.text.split(' — ')[0]}
                {' '}
                <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  open <ExternalLink className="inline h-3 w-3" />
                </a>
                {s.text.includes(' — ') && <span className="text-muted-foreground"> — {s.text.split(' — ')[1]}</span>}
              </>
            ) : s.text}
          </li>
        ))}
      </ol>
      <CopyBlock content={envBlock} />
      <p className="text-[11px] text-muted-foreground">{footer}</p>
    </div>
  );
}

function CopyBlock({ content }: { content: string }) {
  const [hit, setHit] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setHit(true);
      setTimeout(() => setHit(false), 1500);
    } catch { /* ignore */ }
  };
  return (
    <div className="relative">
      <pre className="bg-background border border-border rounded-lg p-3 text-[11px] font-mono whitespace-pre overflow-x-auto">
        {content}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-card border border-border text-muted-foreground hover:text-foreground"
        title="Copy to clipboard"
      >
        {hit ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

export default TurnSetupBanner;
