// Registers a "A11y" panel in DevTools. The panel UI reuses the popup component.
chrome.devtools.panels.create('A11y', '', 'src/devtools/panel.html', () => {
  // panel ready
});
