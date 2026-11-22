export default async function setup() {
  // Electron may install its binary on first import. Finish that once before
  // workers can race to extract or launch a partially installed executable.
  await import('electron')
}
