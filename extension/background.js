const MENU_ID = 'peanut-read-selection';

const api = globalThis.browser || globalThis.chrome;
const isFirefox = Boolean(globalThis.browser?.sidebarAction);

async function openReader(tabId) {
  if (!tabId) return;

  if (isFirefox) {
    await globalThis.browser.sidebarAction.open();
    return;
  }

  if (api.sidePanel?.open) {
    await api.sidePanel.open({ tabId });
  }
}

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.removeAll().then(() => {
    api.contextMenus.create({
      id: MENU_ID,
      title: 'Read selection with Peanut 2 Speech',
      contexts: ['selection']
    });
  });
});

api.action.onClicked.addListener(async (tab) => {
  await openReader(tab?.id);
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  await openReader(tab.id);
  await api.storage.session.set({
    pendingSelection: info.selectionText || ''
  });
});

api.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-reader') return;
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  await openReader(tab?.id);
});
