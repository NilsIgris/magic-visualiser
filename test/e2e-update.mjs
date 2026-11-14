// Vérifie le câblage des mises à jour dans une version empaquetée.
export default async function run({ win, app }) {
  const js = (c) => win.webContents.executeJavaScript(c, true);
  await new Promise((r) => setTimeout(r, 1500));
  const support = await js('window.mtg.updates.support()');
  const check = await js('window.mtg.updates.check()');
  console.log('UPDATE_SUPPORT', JSON.stringify(support));
  console.log('UPDATE_CHECK', JSON.stringify(check));
  app.exit(0);
}
