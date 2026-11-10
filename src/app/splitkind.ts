import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Currency = 'USD' | 'JOD' | 'EUR' | 'GBP' | 'INR';
type Category = 'food' | 'stay' | 'transport' | 'fun' | 'other';
type WorkspaceTab = 'expenses' | 'balances';
interface Member { id: string; name: string; color: string; }
interface Expense { id: string; title: string; amount: number; paidBy: string; splitWith: string[]; category: Category; date: string; }
interface Group { name: string; currency: Currency; members: Member[]; expenses: Expense[]; }
interface Balance { member: Member; amount: number; }
interface Settlement { from: Member; to: Member; amount: number; }

const STORAGE_KEY = 'splitkind.group.v1';
const COLORS = ['#d8e9fd', '#ffe4d6', '#e4e0fb', '#d6f2e3', '#ffeebc', '#f7dded', '#dbedf1', '#f4e1c7'];
const CURRENCIES: Currency[] = ['USD', 'JOD', 'EUR', 'GBP', 'INR'];
const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: 'food', label: 'Food & drinks', icon: '☕' },
  { id: 'stay', label: 'Stay', icon: '⌂' },
  { id: 'transport', label: 'Transport', icon: '→' },
  { id: 'fun', label: 'Fun', icon: '✦' },
  { id: 'other', label: 'Other', icon: '◈' },
];
const uid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
const factor = (c: Currency) => c === 'JOD' ? 1000 : 100;
function freshGroup(currency: Currency = 'USD'): Group {
  return { name: 'Our shared tab', currency, members: [
    { id: uid(), name: 'You', color: COLORS[0] },
    { id: uid(), name: 'Friend', color: COLORS[1] }
  ], expenses: [] };
}
function demoGroup(): Group {
  const members = [
    { id: 'm1', name: 'Alex', color: COLORS[0] },
    { id: 'm2', name: 'Jamie', color: COLORS[1] },
    { id: 'm3', name: 'Morgan', color: COLORS[2] },
    { id: 'm4', name: 'Taylor', color: COLORS[3] }
  ];
  return { name: 'The weekend crew', currency: 'USD', members, expenses: [
    { id: 'e1', title: 'Cabin for the weekend', amount: 24000, paidBy: 'm1', splitWith: members.map(m => m.id), category: 'stay', date: '2026-11-07' },
    { id: 'e2', title: 'Groceries & snacks', amount: 8240, paidBy: 'm2', splitWith: members.map(m => m.id), category: 'food', date: '2026-11-08' },
    { id: 'e3', title: 'Fuel for the drive', amount: 5600, paidBy: 'm3', splitWith: members.map(m => m.id), category: 'transport', date: '2026-11-08' },
    { id: 'e4', title: 'Sunday brunch', amount: 6800, paidBy: 'm4', splitWith: members.map(m => m.id), category: 'food', date: '2026-11-09' }
  ] as Expense[] };
}
function validGroup(value: unknown): value is Group {
  if (!value || typeof value !== 'object') return false;
  const g = value as Partial<Group>;
  if (typeof g.name !== 'string' || g.name.length > 100 || !CURRENCIES.includes(g.currency as Currency)) return false;
  if (!Array.isArray(g.members) || g.members.length < 2 || g.members.length > 50 || !Array.isArray(g.expenses) || g.expenses.length > 300) return false;
  const ids = new Set<string>();
  for (const m of g.members) {
    if (!m || typeof m.id !== 'string' || m.id.length > 100 || typeof m.name !== 'string' || m.name.length > 70 || typeof m.color !== 'string' || ids.has(m.id)) return false;
    ids.add(m.id);
  }
  for (const e of g.expenses) {
    if (!e || typeof e.id !== 'string' || typeof e.title !== 'string' || e.title.length > 160 || !Number.isSafeInteger(e.amount) || e.amount <= 0 || !ids.has(e.paidBy) || !Array.isArray(e.splitWith) || !e.splitWith.length || e.splitWith.some((id: string) => !ids.has(id)) || !CATEGORIES.some(c => c.id === e.category) || typeof e.date !== 'string') return false;
  }
  return true;
}
function loadGroup(): Group {
  if (typeof window === 'undefined') return demoGroup();
  try {
    const fromLink = new URLSearchParams(window.location.search).get('group');
    if (fromLink && fromLink.length < 20000) {
      const bytes = Uint8Array.from(atob(fromLink.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (validGroup(parsed)) return parsed;
    }
  } catch { /* Invalid link falls back to local data. */ }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (validGroup(parsed)) return parsed;
    }
  } catch { /* Private browsing may block storage. */ }
  return demoGroup();
}

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  readonly group = signal<Group>(loadGroup());
  readonly tab = signal<WorkspaceTab>('expenses');
  readonly modal = signal<'expense' | 'member' | 'share' | null>(null);
  readonly toast = signal('');
  readonly isDemo = signal(this.group().members.some(m => m.id === 'm1'));
  readonly categories = CATEGORIES;
  readonly currencies = CURRENCIES;
  newMember = '';
  expenseTitle = '';
  expenseAmount: number | null = null;
  expensePayer = '';
  expenseCategory: Category = 'food';
  selectedMembers = new Set<string>();
  shareUrl = '';
  formError = '';
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  readonly total = computed(() => this.group().expenses.reduce((sum, e) => sum + e.amount, 0));
  readonly balances = computed<Balance[]>(() => {
    const group = this.group();
    const ledger = new Map(group.members.map(m => [m.id, 0]));
    for (const expense of group.expenses) {
      ledger.set(expense.paidBy, (ledger.get(expense.paidBy) ?? 0) + expense.amount);
      const participants = [...new Set(expense.splitWith)];
      const base = Math.floor(expense.amount / participants.length);
      const remainder = expense.amount % participants.length;
      participants.forEach((id, i) => ledger.set(id, (ledger.get(id) ?? 0) - base - (i < remainder ? 1 : 0)));
    }
    return group.members.map(member => ({ member, amount: ledger.get(member.id) ?? 0 }));
  });
  readonly settlements = computed<Settlement[]>(() => {
    const credits = this.balances().filter(b => b.amount > 0).map(b => ({ ...b })).sort((a, b) => b.amount - a.amount);
    const debts = this.balances().filter(b => b.amount < 0).map(b => ({ ...b, amount: -b.amount })).sort((a, b) => b.amount - a.amount);
    const result: Settlement[] = [];
    let i = 0, j = 0;
    while (i < debts.length && j < credits.length) {
      const amount = Math.min(debts[i].amount, credits[j].amount);
      if (amount) result.push({ from: debts[i].member, to: credits[j].member, amount });
      debts[i].amount -= amount;
      credits[j].amount -= amount;
      if (debts[i].amount === 0) i++;
      if (credits[j].amount === 0) j++;
    }
    return result;
  });
  readonly latestExpenses = computed(() => [...this.group().expenses].reverse());

  money(minor: number): string {
    const currency = this.group().currency;
    const digits = currency === 'JOD' ? 3 : 2;
    return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / factor(currency));
  }
  member(id: string): Member | undefined { return this.group().members.find(m => m.id === id); }
  category(id: Category) { return CATEGORIES.find(c => c.id === id) ?? CATEGORIES[4]; }
  initials(name: string): string { return (name.trim().split(/\s+/).map(p => p[0] ?? '').slice(0, 2).join('') || '?').toUpperCase(); }
  dateLabel(date: string): string { return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  private save(next: Group): void {
    this.group.set(next);
    this.isDemo.set(false);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { this.notify('Your browser could not save this group.'); }
  }
  private notify(message: string): void {
    this.toast.set(message);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.toast.set(''), 4500);
  }
  renameGroup(name: string): void { this.save({ ...this.group(), name: name.slice(0, 70) }); }
  changeCurrency(currency: Currency): void {
    if (this.group().expenses.length || !CURRENCIES.includes(currency)) return;
    this.save({ ...this.group(), currency });
  }
  startFresh(): void {
    if (!this.isDemo() && this.group().expenses.length && !window.confirm('Start a new group? Your current local group will be replaced. Share or export it first if you want to keep it.')) return;
    this.save(freshGroup(this.group().currency));
    this.tab.set('expenses');
    this.modal.set(null);
    window.history.replaceState({}, '', window.location.pathname);
    this.notify('Fresh group ready. Make it yours!');
    this.scrollToWorkspace();
  }
  loadDemo(): void {
    if (this.group().expenses.length && !window.confirm('Load the demo? It will replace your current local group.')) return;
    this.save(demoGroup());
    this.isDemo.set(true);
    this.tab.set('expenses');
    this.modal.set(null);
    window.history.replaceState({}, '', window.location.pathname);
    this.scrollToWorkspace();
  }
  scrollToWorkspace(): void { document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  openMember(): void { this.newMember = ''; this.formError = ''; this.modal.set('member'); }
  addMember(): void {
    const name = this.newMember.trim();
    if (!name || name.length > 40) { this.formError = 'Please enter a name (up to 40 characters).'; return; }
    if (this.group().members.length >= 50) { this.formError = 'This group has reached the 50-person limit.'; return; }
    if (this.group().members.some(m => m.name.toLowerCase() === name.toLowerCase())) { this.formError = 'That name is already in this group.'; return; }
    const person: Member = { id: uid(), name, color: COLORS[this.group().members.length % COLORS.length] };
    this.save({ ...this.group(), members: [...this.group().members, person] });
    this.modal.set(null);
    this.notify(name + ' is in the group.');
  }
  removeMember(id: string): void {
    const g = this.group();
    if (g.members.length <= 2) { this.notify('A group needs at least two people.'); return; }
    if (g.expenses.some(e => e.paidBy === id || e.splitWith.includes(id))) { this.notify('Remove expenses involving this person first.'); return; }
    this.save({ ...g, members: g.members.filter(m => m.id !== id) });
  }
  openExpense(): void {
    this.expenseTitle = '';
    this.expenseAmount = null;
    this.expensePayer = this.group().members[0].id;
    this.expenseCategory = 'food';
    this.selectedMembers = new Set(this.group().members.map(m => m.id));
    this.formError = '';
    this.modal.set('expense');
  }
  toggleParticipant(id: string, checked: boolean): void {
    const next = new Set(this.selectedMembers);
    if (checked) next.add(id); else next.delete(id);
    this.selectedMembers = next;
  }
  addExpense(): void {
    const group = this.group();
    const title = this.expenseTitle.trim();
    const amount = Math.round((this.expenseAmount ?? 0) * factor(group.currency));
    if (!title || title.length > 100) { this.formError = 'Add a short expense description.'; return; }
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000000) { this.formError = 'Enter a valid amount greater than zero.'; return; }
    if (!group.members.some(m => m.id === this.expensePayer)) { this.formError = 'Select who paid.'; return; }
    if (!this.selectedMembers.size) { this.formError = 'Choose at least one person to split with.'; return; }
    if (group.expenses.length >= 300) { this.formError = 'This group has reached the 300-expense limit.'; return; }
    const expense: Expense = {
      id: uid(), title, amount, paidBy: this.expensePayer,
      splitWith: group.members.filter(m => this.selectedMembers.has(m.id)).map(m => m.id),
      category: this.expenseCategory, date: new Date().toLocaleDateString('en-CA')
    };
    this.save({ ...group, expenses: [...group.expenses, expense] });
    this.modal.set(null);
    this.tab.set('expenses');
    this.notify('Expense added. The math is up to date.');
  }
  removeExpense(id: string): void {
    const g = this.group();
    this.save({ ...g, expenses: g.expenses.filter(e => e.id !== id) });
    this.notify('Expense removed.');
  }
  summaryText(): string {
    const group = this.group();
    const lines = ['✦ ' + (group.name || 'SplitKind group') + ' · SplitKind',
      group.members.length + ' people · ' + group.expenses.length + ' expenses · ' + this.money(this.total()) + ' total',
      '', 'SETTLE UP'];
    if (!this.settlements().length) lines.push('All square! Nothing to settle.');
    else this.settlements().forEach(s => lines.push(s.from.name + ' → ' + s.to.name + ': ' + this.money(s.amount)));
    lines.push('', 'Split simply at SplitKind.');
    return lines.join('\n');
  }
  private async copyText(value: string, success: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); this.notify(success); }
    catch {
      try {
        const field = document.createElement('textarea');
        field.value = value; field.style.position = 'fixed'; field.style.opacity = '0';
        document.body.appendChild(field); field.select();
        const copied = document.execCommand('copy'); field.remove();
        this.notify(copied ? success : 'Select and copy the text manually.');
      } catch { this.notify('Copy is unavailable in this browser.'); }
    }
  }
  async copySummary(): Promise<void> { await this.copyText(this.summaryText(), 'Settlement summary copied!'); }
  async shareSummary(): Promise<void> {
    if (navigator.share) {
      try { await navigator.share({ title: this.group().name + ' · SplitKind', text: this.summaryText() }); return; }
      catch (error) { if ((error as Error).name === 'AbortError') return; }
    }
    await this.copySummary();
  }
  openShare(): void {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(this.group()));
      let binary = '';
      bytes.forEach(byte => binary += String.fromCharCode(byte));
      const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      this.shareUrl = window.location.origin + window.location.pathname + '?group=' + encoded;
      if (this.shareUrl.length > 16000) { this.notify('Group is too large for a share link. Use the text summary instead.'); return; }
      this.modal.set('share');
    } catch { this.notify('Could not create a share link for this group.'); }
  }
  async copyLink(): Promise<void> { await this.copyText(this.shareUrl, 'Group snapshot link copied!'); }
  exportCsv(): void {
    const cell = (value: string | number) => '"' + String(value).replace(/"/g, '""') + '"';
    const rows = [['Date', 'Expense', 'Category', 'Paid by', 'Amount', 'Currency', 'Split with'],
      ...this.group().expenses.map(e => [e.date, e.title, this.category(e.category).label,
        this.member(e.paidBy)?.name ?? '',
        (e.amount / factor(this.group().currency)).toFixed(this.group().currency === 'JOD' ? 3 : 2),
        this.group().currency, e.splitWith.map(id => this.member(id)?.name ?? '').join('; ')])];
    const csv = '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'splitkind-expenses.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.notify('CSV downloaded.');
  }
}
