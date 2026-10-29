import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getWebhookSetup, type WebhookSetupInfo } from '../../api/orgs';

/**
 * Modal that exposes the CC notification webhook URL an org admin has to
 * paste into the Clever Cloud console. Portalled to `document.body` so the
 * `position: fixed` layer escapes the topbar's `backdrop-filter` containing
 * block (otherwise the modal is clipped inside the header).
 *
 * Minimal surface: URL + Copy button as the primary action; everything else
 * (instructions, event list, console link) folds into a `<details>` block.
 */
export function WebhookSetupModal({
  orgId,
  onClose,
}: {
  orgId: string;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<WebhookSetupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWebhookSetup(orgId)
      .then((v) => !cancelled && setInfo(v))
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [onClose]);

  const copy = async () => {
    if (!info?.url) return;
    await navigator.clipboard.writeText(info.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const node = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(12,10,28,0.72)' }}
      onClick={onClose}
    >
      <div
        className="cc-panel rounded-2xl p-5 max-w-[520px] w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div
              className="font-overtitle text-[10px]"
              style={{ color: 'var(--cc-orange)' }}
            >
              Real-time setup
            </div>
            <h2 className="font-semibold text-lg">Webhook URL for this org</h2>
          </div>
          <button
            className="cc-muted hover:text-white"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!info && !error && (
          <div className="cc-muted text-sm py-6 text-center">Loading…</div>
        )}

        {error && (
          <div
            className="text-[12px] rounded px-3 py-2"
            style={{
              background: 'rgba(230,63,72,0.12)',
              color: 'var(--cc-red-1)',
            }}
          >
            {error}
          </div>
        )}

        {info && !info.enabled && (
          <div
            className="text-[13px] rounded px-3 py-3"
            style={{ background: 'rgba(241,240,251,0.05)' }}
          >
            Webhook support is disabled on this deployment
            (<code>USE_WEBHOOKS=false</code>). Status updates come from
            polling — nothing to configure.
          </div>
        )}

        {info && info.enabled && info.url && (
          <>
            <div
              className="flex items-stretch gap-2 rounded-lg overflow-hidden"
              style={{ background: 'rgba(0,0,0,0.35)' }}
            >
              <code className="px-3 py-2 flex-1 text-[12px] break-all select-all">
                {info.url}
              </code>
              <button
                onClick={copy}
                className="px-4 text-[12px] font-medium transition shrink-0"
                style={{
                  background: copied
                    ? 'var(--cc-green)'
                    : 'var(--cc-orange)',
                  color: 'var(--cc-white)',
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>

            <details className="mt-4 text-[12px] cc-muted">
              <summary
                className="cursor-pointer select-none py-1 hover:text-white"
                style={{ color: 'var(--cc-white)' }}
              >
                Show setup instructions
              </summary>
              <div className="mt-2 pl-1">
                <ol className="pl-5 list-decimal space-y-2">
                  <li>
                    Open{' '}
                    <a
                      href={info.console_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      style={{ color: 'var(--cc-orange)' }}
                    >
                      CC console → Notifications
                    </a>{' '}
                    → <em>Create a webhook</em>.
                  </li>
                  <li>Paste the URL above and check these events:</li>
                </ol>
                <div className="mt-2 flex flex-wrap gap-1">
                  {info.events.map((e) => (
                    <code
                      key={e}
                      className="text-[11px] rounded px-1.5 py-0.5"
                      style={{
                        background: 'rgba(241,240,251,0.06)',
                        color: 'var(--cc-white)',
                      }}
                    >
                      {e}
                    </code>
                  ))}
                </div>
                <p className="mt-3 text-[11px]">
                  Ask an admin/manager of the org to complete the step —
                  myCCtown can&rsquo;t create the webhook on their behalf
                  without their permissions.
                </p>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
