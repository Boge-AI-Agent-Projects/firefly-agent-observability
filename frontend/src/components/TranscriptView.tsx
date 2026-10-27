import type { TraceDetail } from '../types';
import { useI18n } from '../i18n';
import { messagesFromTrace } from '../utils/traceContent';

function roleLabel(role: string, t: ReturnType<typeof useI18n>['t']): string {
  if (role === 'user') return t('detail.user');
  if (role === 'assistant') return t('detail.assistant');
  if (role === 'tool') return t('detail.tool');
  return t('detail.system');
}

function MessageBubble({ role, content }: { role: string; content: string }) {
  const { t } = useI18n();
  const isUser = role === 'user';
  const isTool = role === 'tool';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
        isUser
          ? 'bg-[var(--color-accent-blue)]/15 text-[var(--color-text-primary)] border border-[var(--color-accent-blue)]/30'
          : isTool
            ? 'bg-emerald-50 text-emerald-950 border border-emerald-200'
          : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] border border-[var(--color-border)]'
      }`}>
        <p className="text-xs font-medium mb-1 text-[var(--color-text-secondary)]">
          {roleLabel(role, t)}
        </p>
        <pre className="whitespace-pre-wrap font-sans text-sm">{content}</pre>
      </div>
    </div>
  );
}

export function TranscriptView({ trace }: { trace: TraceDetail }) {
  const { t } = useI18n();
  const messages = messagesFromTrace(trace);

  if (messages.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--color-text-secondary)]">
        {t('detail.noConversationData')}
      </div>
    );
  }

  return (
    <div className="p-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-primary)] max-h-[600px] overflow-y-auto">
      {messages.map((msg, i) => (
        <MessageBubble key={i} role={msg.role} content={msg.content} />
      ))}
    </div>
  );
}
