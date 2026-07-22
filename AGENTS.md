Always run Electron/Playwright E2E tests under a private X server using `xvfb-run -a -s "-screen 0 1920x1080x24"`.
If the request somehow involves other repos (e.g. Website, APT, RPM, Flatpak, AUR, ...) you can find them in the parent folder .
Before considering work done here, you need to reproduce it with the test suite (for bugfixes), and verify that your fix/feature works (unless otherwise told to do so).
