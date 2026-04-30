// Listens in every tab for highlight messages from the popup.
const OVERLAY_ID = '__a11y_audit_overlay__';

function clear(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

function highlight(selector: string, message: string): void {
  clear();
  const target = document.querySelector(selector) as HTMLElement | null;
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const r = target.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: 'fixed',
    top: `${r.top - 4}px`,
    left: `${r.left - 4}px`,
    width: `${r.width + 8}px`,
    height: `${r.height + 8}px`,
    border: '3px solid #c00',
    borderRadius: '4px',
    pointerEvents: 'none',
    zIndex: '2147483647',
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.25)',
  });
  const tooltip = document.createElement('div');
  Object.assign(tooltip.style, {
    position: 'absolute',
    bottom: '100%',
    left: '0',
    background: '#1a1a1a',
    color: '#fff',
    padding: '6px 10px',
    fontSize: '12px',
    borderRadius: '3px',
    marginBottom: '4px',
    maxWidth: '300px',
    whiteSpace: 'normal',
  });
  tooltip.textContent = message;
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);
  setTimeout(clear, 6000);
}

chrome.runtime.onMessage.addListener(
  (msg: { type?: string; selector?: string; message?: string }) => {
    if (msg.type === 'highlight' && msg.selector) {
      highlight(msg.selector, msg.message ?? '');
    }
    if (msg.type === 'clear-highlight') clear();
  },
);
