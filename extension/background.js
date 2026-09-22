const MENU_ID = 'peanut-read-selection';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Read selection with Peanut 2 Speech',
      contexts: ['selection']
    });
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
  await chrome.storage.session.set({
    pendingSelection: info.selectionText || ''
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-reader') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
});
