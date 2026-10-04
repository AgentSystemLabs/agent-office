import './boss-workstation.css';
import { h } from '../../ui/dom';

export type BossTab = 'terminal' | 'comms' | 'fleet' | 'game';

export class BossWorkstation {
  public readonly el: HTMLDivElement;
  private currentTab: BossTab = 'terminal';
  private terminalLogEl: HTMLDivElement;
  private cmdInput: HTMLInputElement;
  private commsHistoryEl: HTMLDivElement;
  private recipientSelect: HTMLSelectElement;
  private directiveInput: HTMLTextAreaElement;
  private fleetContainer: HTMLDivElement;
  private contentContainer: HTMLDivElement;
  private readonly gameContainer: HTMLDivElement;
  private onTabSwitch?: (tab: BossTab) => void;

  constructor(gameCanvas: HTMLCanvasElement, onTabSwitch?: (tab: BossTab) => void) {
    this.onTabSwitch = onTabSwitch;
    this.gameContainer = h('div', { style: 'width:100%;height:100%;display:none;' }, gameCanvas);

    // Terminal elements
    this.terminalLogEl = h('div.boss-terminal-log', {}, '👑 BOSS EXECUTIVE HOST TERMINAL (Absolute Permissions)\nType any shell command or click a quick action below.\n');
    this.cmdInput = h('input', {
      type: 'text',
      placeholder: 'Enter command (e.g. python3 budget_guard.py --status)...',
      autofocus: 'true'
    });

    const runBtn = h('button.boss-btn', { type: 'button' }, '⚡ Run');
    runBtn.addEventListener('click', () => this.executeCommand());
    this.cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.executeCommand();
      }
    });

    const quickActions = h(
      'div.boss-quick-actions',
      {},
      this.makeQuickBtn('🛡️ Budget Guard', 'python3 budget_guard.py --status'),
      this.makeQuickBtn('🤖 Lead Status', 'python3 office_lead.py --status'),
      this.makeQuickBtn('📋 Task Queue', 'python3 ceo_dispatch.py --list'),
      this.makeQuickBtn('🧪 Run Tests', 'npm test'),
      this.makeQuickBtn('🌐 Git Status', 'git status -s'),
      this.makeQuickBtn('🧹 Clear Output', '__clear__')
    );

    const terminalView = h(
      'div.boss-terminal-view',
      {},
      quickActions,
      this.terminalLogEl,
      h('div.boss-terminal-input-row', {}, h('span.prompt-symbol', {}, '$'), this.cmdInput, runBtn)
    );

    // Comms elements
    this.recipientSelect = h('select', {});
    this.directiveInput = h('textarea', { rows: '3', placeholder: 'Type executive command or directive to agents...' });
    const sendDirectiveBtn = h('button.boss-btn', { type: 'button' }, '📢 Issue Directive');
    sendDirectiveBtn.addEventListener('click', () => this.sendDirective());

    const commsPresets = h(
      'div.boss-quick-actions',
      {},
      this.makePresetBtn('📊 Status report on micro-SaaS portfolio'),
      this.makePresetBtn('🛡️ Audit budget and confirm zero spend'),
      this.makePresetBtn('🧪 Verify test suites and typechecks'),
      this.makePresetBtn('🚀 Prepare next queued task for dispatch')
    );

    this.commsHistoryEl = h('div.boss-comms-history', {}, h('div', { style: 'color:#94a3b8;font-size:12px;' }, 'Loading directives history...'));

    const commsView = h(
      'div.boss-comms-view',
      {},
      h(
        'div.boss-comms-form',
        {},
        h('label', { style: 'font-size:12px;color:#94a3b8;font-weight:700;' }, 'Directive Recipient:'),
        this.recipientSelect,
        commsPresets,
        this.directiveInput,
        h('div', { style: 'display:flex;justify-content:flex-end;' }, sendDirectiveBtn)
      ),
      h('h3', { style: 'font-size:13px;color:#cbd5e1;font-weight:700;margin-top:4px;' }, 'Directives & Responses Log'),
      this.commsHistoryEl
    );

    // Fleet elements
    this.fleetContainer = h('div.boss-fleet-grid', {}, h('div', { style: 'color:#94a3b8;font-size:12px;' }, 'Loading fleet status...'));
    const fleetView = h(
      'div',
      { style: 'height:100%;overflow-y:auto;' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;' },
        h('h3', { style: 'font-size:14px;color:#cbd5e1;font-weight:700;' }, 'Company Desks & Active Workforce'),
        h('button.boss-quick-btn', { type: 'button', onclick: () => this.refreshState() }, '🔄 Refresh')
      ),
      this.fleetContainer
    );

    // Content container holding tab views
    this.contentContainer = h('div.boss-tab-content', {}, terminalView);

    // Tab bar
    const tabTerminal = this.makeTabBtn('⚡ Host Terminal', 'terminal', true);
    const tabComms = this.makeTabBtn('💬 Talk to Agents', 'comms', false);
    const tabFleet = this.makeTabBtn('📋 Fleet Radar', 'fleet', false);
    const tabGame = this.makeTabBtn('💣 Minesweeper', 'game', false);

    const tabsBar = h('div.boss-tabs', {}, tabTerminal, tabComms, tabFleet, tabGame);

    this.el = h(
      'div.boss-workstation',
      {},
      tabsBar,
      this.contentContainer,
      this.gameContainer
    );

    // Load initial office state
    this.refreshState();
  }

  public get activeTab(): BossTab {
    return this.currentTab;
  }

  public switchTab(tab: BossTab): void {
    this.currentTab = tab;
    const tabs = this.el.querySelectorAll<HTMLButtonElement>('.boss-tab');
    tabs.forEach((t) => {
      const match = t.getAttribute('data-tab') === tab;
      t.classList.toggle('active', match);
    });

    if (tab === 'game') {
      this.contentContainer.style.display = 'none';
      this.gameContainer.style.display = 'block';
    } else {
      this.gameContainer.style.display = 'none';
      this.contentContainer.style.display = 'flex';
      this.contentContainer.innerHTML = '';

      if (tab === 'terminal') {
        const quickActions = h(
          'div.boss-quick-actions',
          {},
          this.makeQuickBtn('🛡️ Budget Guard', 'python3 budget_guard.py --status'),
          this.makeQuickBtn('🤖 Lead Status', 'python3 office_lead.py --status'),
          this.makeQuickBtn('📋 Task Queue', 'python3 ceo_dispatch.py --list'),
          this.makeQuickBtn('🧪 Run Tests', 'npm test'),
          this.makeQuickBtn('🌐 Git Status', 'git status -s'),
          this.makeQuickBtn('🧹 Clear Output', '__clear__')
        );
        const runBtn = h('button.boss-btn', { type: 'button', onclick: () => this.executeCommand() }, '⚡ Run');
        this.contentContainer.appendChild(
          h(
            'div.boss-terminal-view',
            {},
            quickActions,
            this.terminalLogEl,
            h('div.boss-terminal-input-row', {}, h('span.prompt-symbol', {}, '$'), this.cmdInput, runBtn)
          )
        );
        setTimeout(() => this.cmdInput.focus(), 50);
      } else if (tab === 'comms') {
        const sendDirectiveBtn = h('button.boss-btn', { type: 'button', onclick: () => this.sendDirective() }, '📢 Issue Directive');
        const commsPresets = h(
          'div.boss-quick-actions',
          {},
          this.makePresetBtn('📊 Status report on micro-SaaS portfolio'),
          this.makePresetBtn('🛡️ Audit budget and confirm zero spend'),
          this.makePresetBtn('🧪 Verify test suites and typechecks'),
          this.makePresetBtn('🚀 Prepare next queued task for dispatch')
        );
        this.contentContainer.appendChild(
          h(
            'div.boss-comms-view',
            {},
            h(
              'div.boss-comms-form',
              {},
              h('label', { style: 'font-size:12px;color:#94a3b8;font-weight:700;' }, 'Directive Recipient:'),
              this.recipientSelect,
              commsPresets,
              this.directiveInput,
              h('div', { style: 'display:flex;justify-content:flex-end;' }, sendDirectiveBtn)
            ),
            h('h3', { style: 'font-size:13px;color:#cbd5e1;font-weight:700;margin-top:4px;' }, 'Directives & Responses Log'),
            this.commsHistoryEl
          )
        );
      } else if (tab === 'fleet') {
        this.contentContainer.appendChild(
          h(
            'div',
            { style: 'height:100%;overflow-y:auto;' },
            h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;' },
              h('h3', { style: 'font-size:14px;color:#cbd5e1;font-weight:700;' }, 'Company Desks & Active Workforce'),
              h('button.boss-quick-btn', { type: 'button', onclick: () => this.refreshState() }, '🔄 Refresh')
            ),
            this.fleetContainer
          )
        );
        this.refreshState();
      }
    }

    this.onTabSwitch?.(tab);
  }

  private makeTabBtn(label: string, tab: BossTab, active: boolean): HTMLButtonElement {
    const btn = h('button.boss-tab', { type: 'button', 'data-tab': tab, class: active ? 'active' : '' }, label) as HTMLButtonElement;
    btn.addEventListener('click', () => this.switchTab(tab));
    return btn;
  }

  private makeQuickBtn(label: string, cmd: string): HTMLButtonElement {
    const btn = h('button.boss-quick-btn', { type: 'button' }, label) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      if (cmd === '__clear__') {
        this.terminalLogEl.textContent = '👑 BOSS EXECUTIVE HOST TERMINAL (Absolute Permissions)\n';
        return;
      }
      this.cmdInput.value = cmd;
      this.executeCommand();
    });
    return btn;
  }

  private makePresetBtn(text: string): HTMLButtonElement {
    const btn = h('button.boss-quick-btn', { type: 'button' }, text) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      this.directiveInput.value = text;
    });
    return btn;
  }

  private async executeCommand(): Promise<void> {
    const cmd = this.cmdInput.value.trim();
    if (!cmd) return;

    this.terminalLogEl.textContent += `\n$ ${cmd}\n[Running with absolute host permissions...]\n`;
    this.terminalLogEl.scrollTop = this.terminalLogEl.scrollHeight;
    this.cmdInput.value = '';

    try {
      const res = await fetch('/api/boss/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd })
      });

      const data = await res.json() as any;
      if (data.ok) {
        this.terminalLogEl.textContent += (data.stdout || '') + `\n[Exited 0 in ${data.durationMs}ms]\n`;
      } else {
        this.terminalLogEl.textContent += (data.stdout ? data.stdout + '\n' : '') + (data.stderr || 'Command failed') + `\n[Exit Code ${data.exitCode} in ${data.durationMs}ms]\n`;
      }
    } catch (err: any) {
      this.terminalLogEl.textContent += `\n[Execution Error]: ${err.message}\n`;
    }

    this.terminalLogEl.scrollTop = this.terminalLogEl.scrollHeight;
  }

  private async sendDirective(): Promise<void> {
    const prompt = this.directiveInput.value.trim();
    if (!prompt) return;

    const recipient = this.recipientSelect.value;
    const recipientName = this.recipientSelect.options[this.recipientSelect.selectedIndex]?.text || recipient;

    try {
      const res = await fetch('/api/boss/talk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, prompt })
      });

      const data = await res.json() as any;
      this.directiveInput.value = '';

      const item = h(
        'div.boss-comms-item',
        {},
        h(
          'div.boss-comms-item-header',
          {},
          h('span', {}, `👑 Boss ➔ ${recipientName}`),
          h('span', {}, new Date().toLocaleTimeString())
        ),
        h('div', { style: 'color:#f8fafc;' }, prompt),
        h('div', { style: 'font-size:11px;color:#34d399;margin-top:4px;' }, `✓ ${data.message || 'Delivered'}`)
      );

      this.commsHistoryEl.prepend(item);
    } catch (err: any) {
      alert('Failed to send directive: ' + err.message);
    }
  }

  public async refreshState(): Promise<void> {
    try {
      const res = await fetch('/api/boss/state');
      const data = await res.json() as any;

      // Update recipients
      this.recipientSelect.innerHTML = '';
      this.recipientSelect.appendChild(h('option', { value: 'all' }, '📢 All Desks (Broadcast Directive)'));

      if (Array.isArray(data.workers)) {
        data.workers.forEach((w: any) => {
          this.recipientSelect.appendChild(
            h('option', { value: w.id }, `${w.name} (${w.deskId || w.id}) · ${w.status}`)
          );
        });

        // Update Fleet Grid
        this.fleetContainer.innerHTML = '';
        data.workers.forEach((w: any) => {
          const isBusy = w.status === 'busy' || w.status === 'asking';
          const card = h(
            'div.boss-worker-card',
            {},
            h(
              'div.boss-worker-card-header',
              {},
              h('span', { style: 'font-weight:700;font-size:13px;' }, w.name),
              h('span.boss-status-pill', { class: isBusy ? 'boss-status-busy' : 'boss-status-idle' }, w.status)
            ),
            h('div', { style: 'font-size:11px;color:#94a3b8;margin-bottom:6px;' }, `${w.deskId || 'Remote'} • ${w.provider}`),
            h('div', { style: 'font-size:12px;color:#cbd5e1;line-height:1.4;' }, w.activity || w.task || 'Standing by for executive commands')
          );
          this.fleetContainer.appendChild(card);
        });
      }

      // Update pings
      if (Array.isArray(data.pings) && data.pings.length > 0) {
        this.commsHistoryEl.innerHTML = '';
        data.pings.forEach((p: any) => {
          const item = h(
            'div.boss-comms-item',
            {},
            h(
              'div.boss-comms-item-header',
              {},
              h('span', {}, `${p.from} ➔ ${p.recipient || 'Team'}`),
              h('span', {}, new Date(p.createdAt).toLocaleTimeString())
            ),
            h('div', { style: 'color:#f8fafc;' }, p.content)
          );
          this.commsHistoryEl.appendChild(item);
        });
      }
    } catch {
      // Ignore background refresh errors
    }
  }
}
