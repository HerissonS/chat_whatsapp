export type Role = 'admin' | 'operator';

export interface Me {
  id: number;
  username: string;
  name: string;
  email: string | null;
  role: Role;
  roleLabel: string;
  permissions: string[];
  departmentIds: number[];
  mustChangePassword: boolean;
  csrfToken: string;
  preferences: {
    theme?: 'light' | 'dark' | 'system';
    sound?: boolean;
    desktopNotifications?: boolean;
    notificationSound?: import('./sound').SoundId;
    soundVolume?: number;
  };
  passwordMinLength: number;
  mediaMaxMb: number;
}

export interface Ticket {
  id: number;
  status: 'menu' | 'open' | 'closed';
  origin: string;
  classificationId: number | null;
  classificationLabel: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  openedAt: string;
  closedAt: string | null;
  emailStatus: string | null;
}

export interface Conversation {
  id: number;
  departmentId: number;
  contact: {
    id: number;
    name: string;
    pushName: string | null;
    customName: string | null;
    phone: string | null;
    jid: string;
    isGroup: boolean;
    isVip: boolean;
    avatar: 'yes' | 'no' | 'unknown';
    avatarVersion: number;
  };
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
  ticket: Ticket | null;
}

export interface TicketHistoryItem {
  id: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
  contract: string | null;
  equipment: string | null;
  email_status: string | null;
  classification: string | null;
  assignee: string | null;
}

export interface Message {
  id: number;
  conversationId: number;
  ticketId: number | null;
  waId: string;
  fromMe: boolean;
  origin: 'contact' | 'agent' | 'phone' | 'bot';
  senderName: string | null;
  senderJid: string | null;
  userId: number | null;
  userName: string | null;
  type: string;
  body: string | null;
  media: { id: number | null; status: string | null; mime: string | null; name: string | null; size: number | null } | null;
  quoted: { waId: string; preview: string | null; sender: string | null } | null;
  forwarded: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  deleted: boolean;
  edited: boolean;
  timestamp: string;
  reactions: Array<{ emoji: string; reactorName: string | null; fromMe: boolean }>;
}

export interface Classification {
  id: number;
  number: number;
  label: string;
  menuLabel: string;
  isDefault: boolean;
}

export interface ContactEntry {
  id: number;
  departmentId: number;
  name: string;
  phone: string | null;
  isGroup: boolean;
  isVip: boolean;
  avatar: 'yes' | 'no' | 'unknown';
  avatarVersion: number;
  conversationId: number | null;
}

export interface SimpleUser {
  id: number;
  name: string;
  username: string;
  role: Role;
}

export interface WhatsappStatus {
  departmentId: number;
  departmentName: string;
  state: string;
  number: string | null;
  profileName: string | null;
}

export interface Branding {
  systemName: string;
  colors: Record<string, string>;
  dark: Record<string, string>;
  modal: { radius: number; overlayOpacity: number; shadow: 'none' | 'sm' | 'md' | 'lg' };
  font: 'system' | 'arial' | 'verdana' | 'trebuchet' | 'georgia';
  fontScale: number;
  logos: Record<'light' | 'dark' | 'favicon' | 'pdf', { url: string | null; custom: boolean }>;
}
