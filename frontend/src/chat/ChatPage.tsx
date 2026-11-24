import { MessagesSquare } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, Spinner, cx } from '../components/ui';
import { ChatView } from './ChatView';
import { ContactPanel } from './ContactPanel';
import { ConversationList } from './ConversationList';
import { useConversation, useRealtime } from './data';
import { NewConversationModal } from './modals';

/** Tela de atendimento em três colunas: conversas, chat e detalhes do contato/chamado. */
export function ChatPage({ conversationId }: { conversationId: number | null }) {
  const [newOpen, setNewOpen] = useState(false);
  const [panel, setPanel] = useState(() => localStorage.getItem('atl-panel') !== '0');
  const { data: conv, isLoading, isError } = useConversation(conversationId);
  useRealtime(conversationId);

  const togglePanel = () => {
    setPanel((p) => {
      try {
        localStorage.setItem('atl-panel', p ? '0' : '1');
      } catch {
        /* sem armazenamento */
      }
      return !p;
    });
  };

  return (
    <div className="flex h-full bg-background">
      <aside className={cx('w-full shrink-0 border-r border-border/40 bg-surface lg:w-[360px]', conversationId ? 'hidden lg:block' : 'block')}>
        <ConversationList currentId={conversationId} onNew={() => setNewOpen(true)} />
      </aside>
      <main className={cx('min-w-0 flex-1', conversationId ? 'block' : 'hidden lg:block')}>
        {!conversationId && (
          <EmptyState
            icon={<MessagesSquare className="size-7" />}
            title="Selecione uma conversa"
            description="Escolha um atendimento na lista ao lado ou inicie uma nova conversa."
          />
        )}
        {conversationId && isLoading && (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
        {conversationId && isError && <EmptyState title="Conversa não encontrada" description="Ela pode ter sido removida ou você não tem acesso." />}
        {conv && <ChatView conversation={conv} panelOpen={panel} onTogglePanel={togglePanel} />}
      </main>
      {conv && panel && (
        <aside className="hidden w-[320px] shrink-0 border-l border-border/40 bg-surface xl:block">
          <ContactPanel conversation={conv} history={conv.history} />
        </aside>
      )}
      <NewConversationModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
