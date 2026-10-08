import { expect, test } from '@playwright/test';

interface IndexEntry { id: string; type: 'story' | 'docs'; title: string; name: string }

test('every story renders without errors and contacts no other host', async ({ page, request }) => {
  // One test walks all of them; the first visit also waits on Vite's dev compile.
  test.setTimeout(240_000);
  const index = (await (await request.get('/index.json')).json()) as { entries: Record<string, IndexEntry> };
  const stories = Object.values(index.entries).filter((e) => e.type === 'story');
  expect(stories.length).toBeGreaterThan(0);

  const offMachine = new Set<string>();
  page.on('request', (r) => {
    const { protocol, hostname } = new URL(r.url());
    if (protocol.startsWith('http') && hostname !== '127.0.0.1' && hostname !== 'localhost') offMachine.add(r.url());
  });

  const broken: string[] = [];
  for (const story of stories) {
    const errors: string[] = [];
    const onError = (e: Error) => errors.push(e.message);
    const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(m.text()); };
    page.on('pageerror', onError);
    page.on('console', onConsole);
    await page.goto(`/iframe.html?viewMode=story&id=${story.id}`);
    // Rendered, or Storybook's error screen — whichever comes first.
    await page.waitForFunction(() =>
      (document.querySelector('#storybook-root')?.childElementCount ?? 0) > 0
      || document.body.classList.contains('sb-show-errordisplay'));
    const errorShown = await page.evaluate(() => document.body.classList.contains('sb-show-errordisplay'));
    const rendered = await page.locator('#storybook-root').innerHTML();
    if (errorShown || rendered.length === 0 || errors.length > 0) {
      broken.push(`${story.title} › ${story.name}: ${errorShown ? 'error display' : rendered ? errors.join('; ') : 'nothing rendered'}`);
    }
    page.off('pageerror', onError);
    page.off('console', onConsole);
  }

  expect(broken).toEqual([]);
  expect([...offMachine]).toEqual([]);
});
