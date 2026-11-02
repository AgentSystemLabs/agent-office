import { h } from './dom';
import { store } from '../state';
import type { Net } from '../net';
import type { PluginCapability, PluginManifest } from '../../shared/protocol';

export function pluginsSetting(net?: Net) {
  const container = h('div.plugins-list');

  const CAPABILITY_LABEL: Record<PluginCapability, string> = {
    floors: '🏢 Floors',
    queue: '📋 Tasks Queue',
    services: '🌐 Services Board',
    agent: '🤖 Agent Provider',
    issues: '📌 Issues Board',
    pulls: '🔀 PR Board',
    boards: '🎯 Custom Boards',
  };

  const paintPluginCard = (plugin: PluginManifest, isInstalled: boolean) => {
    const statusClass = plugin.status === 'active' ? 'active' : plugin.status === 'error' ? 'error' : 'inactive';
    const statusLabel = plugin.status === 'active' ? '● Active' : plugin.status === 'error' ? '✖ Error' : '○ Inactive';

    const caps = (plugin.capabilities || []).map((cap) =>
      h('span.plugin-cap', {}, CAPABILITY_LABEL[cap] || cap),
    );

    const admin = store.me?.admin;

    const installBtn = h(
      'button.btn',
      {
        type: 'button',
        class: isInstalled ? 'btn-warn' : 'primary',
        disabled: !admin,
        title: admin ? (isInstalled ? 'Uninstall plugin' : 'Install plugin') : 'Only admins can install or uninstall plugins',
        onclick: (e: Event) => {
          if (!admin) return;
          const btn = e.currentTarget as HTMLButtonElement;
          btn.disabled = true;
          btn.textContent = isInstalled ? '⏳ Uninstalling…' : '⏳ Installing…';
          if (isInstalled) {
            net?.send({ t: 'plugin.uninstall', id: plugin.id });
          } else {
            net?.send({ t: 'plugin.install', id: plugin.id });
          }
        },
      },
      isInstalled ? '🗑️ Uninstall' : '⬇️ Install',
    );

    const openFolderBtn = isInstalled && admin
      ? h(
          'button.btn',
          {
            type: 'button',
            title: 'Open the directory where this plugin is installed',
            onclick: () => {
              net?.send({ t: 'plugin.openFolder', id: plugin.id });
            },
          },
          '📁 Open folder',
        )
      : null;

    const githubBtn = plugin.githubUrl
      ? h(
          'a.btn',
          {
            href: plugin.githubUrl,
            target: '_blank',
            rel: 'noopener',
            title: 'View plugin repository on GitHub',
            style: 'text-decoration:none;display:inline-flex;align-items:center;',
          },
          '🌐 GitHub ↗',
        )
      : null;

    const updateBtn = isInstalled && plugin.updateAvailable && admin
      ? h(
          'button.btn.primary',
          {
            type: 'button',
            title: `Update to ${plugin.latestVersion}`,
            onclick: (e: Event) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.disabled = true;
              btn.textContent = '⏳ Updating…';
              net?.send({ t: 'plugin.update', id: plugin.id });
            },
          },
          `⬆️ Update to ${plugin.latestVersion}`,
        )
      : null;

    const actions = h('div.plugin-actions', {}, installBtn, updateBtn, openFolderBtn, githubBtn);

    const versionLabel = plugin.version ? `v${plugin.version}` : plugin.local ? 'local' : '';

    return h(
      'div.plugin-card',
      { class: statusClass },
      h(
        'div.plugin-head',
        {},
        h(
          'div.plugin-title-row',
          {},
          h('h5.plugin-name', {}, plugin.name),
          versionLabel ? h('span.plugin-version', {}, versionLabel) : null,
          plugin.author ? h('span.plugin-author', {}, `by ${plugin.author}`) : null,
        ),
        h('span.plugin-status', { class: statusClass }, statusLabel),
      ),
      h('p.plugin-desc', {}, plugin.description),
      caps.length > 0 ? h('div.plugin-caps', {}, ...caps) : null,
      actions,
      plugin.error ? h('p.plugin-error', {}, `Error: ${plugin.error}`) : null,
    );
  };

  const paint = () => {
    const installed = store.plugins?.plugins || [];
    const pluginStore = store.plugins?.store || [];
    container.replaceChildren();

    const admin = store.me?.admin;
    const headerBtns: HTMLElement[] = [];
    if (admin) {
      headerBtns.push(
        h(
          'button.btn',
          {
            type: 'button',
            title: 'Open the plugins folder on disk',
            onclick: () => net?.send({ t: 'plugin.openFolder' }),
          },
          '📁 Plugins folder',
        ),
      );
    }
    headerBtns.push(
      h(
        'button.btn',
        {
          type: 'button',
          title: 'Refresh plugins list',
          onclick: () => net?.send({ t: 'plugins.list' }),
        },
        '↻',
      ),
    );

    const headerBar = h(
      'div.plugin-store-header',
      { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;' },
      h('p.setting-note', { style: 'margin:0;' }, `Plugin Store (${pluginStore.length} available)`),
      h('div', { style: 'display:flex;gap:6px;' }, ...headerBtns),
    );
    container.append(headerBar);

    if (admin) {
      const gitInput = h('input', {
        type: 'text',
        placeholder: 'https://github.com/user/repo',
        'aria-label': 'Git URL',
        style: 'flex:1;font:inherit;font-size:14px;border:3px solid var(--ink);border-radius:12px;padding:8px 12px;background:#fff;outline:none;box-sizing:border-box;',
      }) as HTMLInputElement;

      const doGitInstall = () => {
        const url = gitInput.value.trim();
        if (url) {
          gitInstallBtn.disabled = true;
          gitInstallBtn.textContent = '⏳ Installing…';
          net?.send({ t: 'plugin.installFromGit', url });
          gitInput.value = '';
          setTimeout(() => {
            gitInstallBtn.disabled = false;
            gitInstallBtn.textContent = '⬇️ Install from Git';
          }, 8000);
        }
      };

      gitInput.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          doGitInstall();
        }
      });

      const gitInstallBtn = h(
        'button.btn.primary',
        {
          type: 'button',
          onclick: () => doGitInstall(),
        },
        '⬇️ Install from Git',
      ) as HTMLButtonElement;

      const gitInstallBar = h(
        'div.plugin-git-install',
        { style: 'display:flex;gap:6px;margin-bottom:12px;align-items:center;' },
        gitInput,
        gitInstallBtn,
      );
      container.append(gitInstallBar);
    }

    const installedSection = h('div.plugin-section', {}, h('h4', {}, `Installed (${installed.length})`));
    if (installed.length === 0) {
      installedSection.append(h('p.setting-note', {}, 'No plugins installed'));
    } else {
      for (const plugin of installed) {
        installedSection.append(paintPluginCard(plugin, true));
      }
    }
    container.append(installedSection);

    const storeSection = h('div.plugin-section', {}, h('h4', {}, `Available (${pluginStore.length})`));
    if (pluginStore.length === 0) {
      storeSection.append(h('p.setting-note', {}, 'No plugins available in the registry'));
    } else {
      for (const plugin of pluginStore) {
        storeSection.append(paintPluginCard(plugin, false));
      }
    }
    container.append(storeSection);
  };

  paint();
  return {
    element: container,
    paint,
  };
}
